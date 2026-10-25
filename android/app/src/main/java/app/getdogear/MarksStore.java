package app.getdogear;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * DogEar's native store for position and the in-playback marks
 * (beta.5, app-first): the reading place per document, favorites,
 * bookmarks, tags and notes — one JSON document in app-private
 * storage, written through on every mutation.
 *
 * This store is why Save / Continue / Bookmarks / Tags / Notes /
 * Favorites can live on the native state machine instead of the
 * page: the marks exist whether or not the WebView has rendered,
 * they are timestamped to the chunk the listener was on, and they
 * survive the app being killed — the Audible property the owner
 * named ("position always saved").
 *
 * Shape:
 *   positions: { docId: {chunk, chunks, title, at} }   — the LIVE
 *     place, rewritten on every chunk the voice speaks.
 *   saved:     { docId: {chunk, chunks, title, at} }   — the
 *     EXPLICIT save (the Save button only). Save pins a place;
 *     live reading never drags the pin. Continue prefers the pin
 *     for its document, else the live place.
 *   favorites: [docId]
 *   bookmarks: [{id, docId, chunk, label, at}]
 *   tags:      { docId: [{tag, chunk, at}] }
 *   notes:     [{id, docId, chunk, text, at}]
 *
 * Storage is injected (a file in production, memory in tests) so
 * the state machine's JVM tests exercise the real store logic.
 */
public final class MarksStore {

    public interface Storage {
        String read();
        void write(String contents);
    }

    /** Production storage: one private file, replaced atomically-ish. */
    public static Storage fileStorage(final File file) {
        return new Storage() {
            @Override public String read() {
                try {
                    if (!file.exists()) return null;
                    FileInputStream in = new FileInputStream(file);
                    byte[] buf = new byte[(int) file.length()];
                    int off = 0, n;
                    while (off < buf.length && (n = in.read(buf, off, buf.length - off)) != -1) {
                        off += n;
                    }
                    in.close();
                    return new String(buf, 0, off, StandardCharsets.UTF_8);
                } catch (Exception e) {
                    return null;
                }
            }

            @Override public void write(String contents) {
                try {
                    File tmp = new File(file.getParentFile(), file.getName() + ".tmp");
                    FileOutputStream out = new FileOutputStream(tmp);
                    out.write(contents.getBytes(StandardCharsets.UTF_8));
                    out.close();
                    if (!tmp.renameTo(file)) {
                        // Same-directory rename is atomic on Android;
                        // if it ever refuses, fall back to a direct write.
                        FileOutputStream direct = new FileOutputStream(file);
                        direct.write(contents.getBytes(StandardCharsets.UTF_8));
                        direct.close();
                    }
                } catch (Exception ignored) {
                    // A failed marks write must never crash playback;
                    // the in-memory copy stays authoritative for the
                    // session and the next mutation retries the write.
                }
            }
        };
    }

    private final Storage storage;
    private JSONObject root;

    public MarksStore(Storage storage) {
        this.storage = storage;
        JSONObject loaded = null;
        try {
            String raw = storage.read();
            if (raw != null && !raw.isEmpty()) loaded = new JSONObject(raw);
        } catch (Exception ignored) {}
        if (loaded == null) loaded = new JSONObject();
        this.root = loaded;
    }

    private synchronized void persist() {
        try { storage.write(root.toString()); } catch (Exception ignored) {}
    }

    private JSONObject map(String key) {
        JSONObject p = root.optJSONObject(key);
        if (p == null) {
            p = new JSONObject();
            try { root.put(key, p); } catch (Exception ignored) {}
        }
        return p;
    }

    private JSONObject positions() { return map("positions"); }
    private JSONObject saved() { return map("saved"); }

    // ------------------------------------------------------------------
    // Positions (Save / Continue)
    // ------------------------------------------------------------------

    /** Record a place. {@code explicit} = the Save button: the
     *  record lands in the PINNED map and live reading never moves
     *  it. Otherwise the record is the live place. */
    public synchronized void savePosition(String docId, String title,
                                          int chunk, int chunks,
                                          boolean explicit, long atMs) {
        if (docId == null) return;
        try {
            JSONObject rec = new JSONObject();
            rec.put("chunk", chunk);
            rec.put("chunks", chunks);
            rec.put("title", title == null ? "" : title);
            rec.put("at", atMs);
            (explicit ? saved() : positions()).put(docId, rec);
            persist();
        } catch (Exception ignored) {}
    }

    /** The LIVE place for a document, or null (a copy). */
    public synchronized JSONObject positionFor(String docId) {
        return copyOf(positions(), docId);
    }

    /** The PINNED (explicitly saved) place for a document, or null. */
    public synchronized JSONObject savedFor(String docId) {
        return copyOf(saved(), docId);
    }

    private JSONObject copyOf(JSONObject map, String docId) {
        if (docId == null) return null;
        JSONObject rec = map.optJSONObject(docId);
        if (rec == null) return null;
        try { return new JSONObject(rec.toString()); } catch (Exception e) { return null; }
    }

    /** The best Continue target: the preferred document's pin,
     *  else its live place; with no preference (or neither), the
     *  most recently touched document's best record. Adds "docId"
     *  (and "pinned": true when the record is a pin) to the copy. */
    public synchronized JSONObject continueTarget(String preferredDocId) {
        if (preferredDocId != null) {
            JSONObject rec = savedFor(preferredDocId);
            boolean pinned = rec != null;
            if (rec == null) rec = positionFor(preferredDocId);
            if (rec != null) {
                try {
                    rec.put("docId", preferredDocId);
                    rec.put("pinned", pinned);
                } catch (Exception ignored) {}
                return rec;
            }
        }
        // Find the most recently touched DOCUMENT first (either map),
        // then apply the same pin-first rule to it: a cold Continue lands
        // exactly where a warm Continue would — on the pin when the most
        // recent document has one.
        String bestId = null;
        long bestAt = -1;
        java.util.Iterator<String> it = positions().keys();
        while (it.hasNext()) {
            String id = it.next();
            JSONObject rec = positions().optJSONObject(id);
            if (rec != null && rec.optLong("at", 0) > bestAt) {
                bestAt = rec.optLong("at", 0); bestId = id;
            }
        }
        it = saved().keys();
        while (it.hasNext()) {
            String id = it.next();
            JSONObject rec = saved().optJSONObject(id);
            if (rec != null && rec.optLong("at", 0) > bestAt) {
                bestAt = rec.optLong("at", 0); bestId = id;
            }
        }
        if (bestId == null) return null;
        JSONObject rec = savedFor(bestId);
        boolean pinned = rec != null;
        if (rec == null) rec = positionFor(bestId);
        if (rec != null) {
            try {
                rec.put("docId", bestId);
                rec.put("pinned", pinned);
            } catch (Exception ignored) {}
        }
        return rec;
    }

    public synchronized boolean hasAnyPosition() {
        return positions().length() > 0 || saved().length() > 0;
    }

    // ------------------------------------------------------------------
    // Whole-document removal (redesign: Library Remove)
    // ------------------------------------------------------------------

    /** Remove EVERYTHING this store holds for a document: the
     *  live place, the pinned place, the favorite flag, and every
     *  bookmark, tag and note that names it. The Library's Remove
     *  confirms exactly this list to the user before calling, in
     *  the brief's words — document, saved place, bookmarks, tags
     *  and notes — so the promise and the act are the same list. */
    public synchronized void deleteDocument(String docId) {
        if (docId == null) return;
        positions().remove(docId);
        saved().remove(docId);
        JSONObject tags = root.optJSONObject("tags");
        if (tags != null) tags.remove(docId);
        try {
            JSONArray favs = root.optJSONArray("favorites");
            if (favs != null) {
                JSONArray kept = new JSONArray();
                for (int i = 0; i < favs.length(); i++) {
                    if (!docId.equals(favs.optString(i, ""))) kept.put(favs.get(i));
                }
                root.put("favorites", kept);
            }
            for (String key : new String[]{"bookmarks", "notes"}) {
                JSONArray all = root.optJSONArray(key);
                if (all != null) {
                    JSONArray kept = new JSONArray();
                    for (int i = 0; i < all.length(); i++) {
                        JSONObject o = all.optJSONObject(i);
                        if (o != null && !docId.equals(o.optString("docId", ""))) {
                            kept.put(o);
                        }
                    }
                    root.put(key, kept);
                }
            }
        } catch (Exception ignored) {}
        persist();
    }

    // ------------------------------------------------------------------
    // Favorites
    // ------------------------------------------------------------------

    public synchronized boolean isFavorite(String docId) {
        if (docId == null) return false;
        JSONArray favs = root.optJSONArray("favorites");
        if (favs == null) return false;
        for (int i = 0; i < favs.length(); i++) {
            if (docId.equals(favs.optString(i, null))) return true;
        }
        return false;
    }

    /** Toggles; returns the new state. */
    public synchronized boolean toggleFavorite(String docId) {
        if (docId == null) return false;
        try {
            JSONArray favs = root.optJSONArray("favorites");
            if (favs == null) {
                favs = new JSONArray();
                root.put("favorites", favs);
            }
            for (int i = 0; i < favs.length(); i++) {
                if (docId.equals(favs.optString(i, null))) {
                    favs.remove(i);
                    persist();
                    return false;
                }
            }
            favs.put(docId);
            persist();
            return true;
        } catch (Exception e) {
            return isFavorite(docId);
        }
    }

    // ------------------------------------------------------------------
    // Bookmarks / tags / notes
    // ------------------------------------------------------------------

    public synchronized void addBookmark(String docId, int chunk, String label, long atMs) {
        if (docId == null) return;
        try {
            JSONArray arr = root.optJSONArray("bookmarks");
            if (arr == null) {
                arr = new JSONArray();
                root.put("bookmarks", arr);
            }
            JSONObject b = new JSONObject();
            b.put("id", "b" + atMs + "-" + arr.length());
            b.put("docId", docId);
            b.put("chunk", chunk);
            b.put("label", label == null ? "" : label);
            b.put("at", atMs);
            arr.put(b);
            persist();
        } catch (Exception ignored) {}
    }

    public synchronized void addTag(String docId, int chunk, String tag, long atMs) {
        if (docId == null || tag == null || tag.trim().isEmpty()) return;
        try {
            JSONObject tags = root.optJSONObject("tags");
            if (tags == null) {
                tags = new JSONObject();
                root.put("tags", tags);
            }
            JSONArray arr = tags.optJSONArray(docId);
            if (arr == null) {
                arr = new JSONArray();
                tags.put(docId, arr);
            }
            String clean = tag.trim();
            for (int i = 0; i < arr.length(); i++) {
                if (clean.equalsIgnoreCase(arr.optJSONObject(i) != null
                        ? arr.optJSONObject(i).optString("tag", "") : "")) {
                    return; // already tagged — a tag is a set member, not a log
                }
            }
            JSONObject t = new JSONObject();
            t.put("tag", clean);
            t.put("chunk", chunk);
            t.put("at", atMs);
            arr.put(t);
            persist();
        } catch (Exception ignored) {}
    }

    public synchronized void addNote(String docId, int chunk, String text, long atMs) {
        if (docId == null || text == null || text.trim().isEmpty()) return;
        try {
            JSONArray arr = root.optJSONArray("notes");
            if (arr == null) {
                arr = new JSONArray();
                root.put("notes", arr);
            }
            JSONObject n = new JSONObject();
            n.put("id", "n" + atMs + "-" + arr.length());
            n.put("docId", docId);
            n.put("chunk", chunk);
            n.put("text", text.trim());
            n.put("at", atMs);
            arr.put(n);
            persist();
        } catch (Exception ignored) {}
    }

    /** Everything the page needs to render one document's marks:
     *  {favorite, position, bookmarks[], tags[], notes[]}. */
    public synchronized JSONObject marksFor(String docId) {
        JSONObject out = new JSONObject();
        try {
            out.put("docId", docId);
            out.put("favorite", isFavorite(docId));
            JSONObject pos = positionFor(docId);
            out.put("position", pos == null ? JSONObject.NULL : pos);
            JSONObject pin = savedFor(docId);
            out.put("saved", pin == null ? JSONObject.NULL : pin);
            JSONArray bm = new JSONArray();
            JSONArray all = root.optJSONArray("bookmarks");
            if (all != null) {
                for (int i = 0; i < all.length(); i++) {
                    JSONObject b = all.optJSONObject(i);
                    if (b != null && docId.equals(b.optString("docId", null))) bm.put(b);
                }
            }
            out.put("bookmarks", bm);
            JSONArray tg = new JSONArray();
            JSONObject tags = root.optJSONObject("tags");
            if (tags != null) {
                JSONArray arr = tags.optJSONArray(docId);
                if (arr != null) tg = arr;
            }
            out.put("tags", tg);
            JSONArray nt = new JSONArray();
            JSONArray allNotes = root.optJSONArray("notes");
            if (allNotes != null) {
                for (int i = 0; i < allNotes.length(); i++) {
                    JSONObject n = allNotes.optJSONObject(i);
                    if (n != null && docId.equals(n.optString("docId", null))) nt.put(n);
                }
            }
            out.put("notes", nt);
        } catch (Exception ignored) {}
        return out;
    }
}

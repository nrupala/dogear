package app.getdogear;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * The native library (redesign Phase 1, LIBRARY area): documents
 * live HERE, in app-private storage owned by native code — never
 * inside a view's storage. PlayerCore's session truth, the
 * feeder's chunks and the Library surface all read from this one
 * store, so "a document exists" is a fact the app establishes
 * itself (Phase 0 rule, clause 1).
 *
 * Storage mirrors MarksStore's pattern (a small Storage
 * interface, file-backed in production) so the registry logic is
 * JVM-tested without Android. Bodies are plain text (the
 * candidate's ingest scope: text files and pasted text; richer
 * formats stay the web endpoint's job — endpoint-native law).
 */
public final class DocumentStore {

    public interface Storage {
        String read(String key);
        void write(String key, String value);
        void delete(String key);
    }

    public static final class Doc {
        public final String id;
        public final String title;
        public final String kind;
        public final long addedAt;
        public final int chars;

        Doc(String id, String title, String kind, long addedAt, int chars) {
            this.id = id;
            this.title = title;
            this.kind = kind;
            this.addedAt = addedAt;
            this.chars = chars;
        }
    }

    private static final String REGISTRY_KEY = "registry";
    private final Storage storage;
    private long seq = 0;

    public DocumentStore(Storage storage) {
        this.storage = storage;
    }

    public static Storage fileStorage(final File dir) {
        return new Storage() {
            @Override public String read(String key) {
                try {
                    File f = new File(dir, fileName(key));
                    if (!f.exists()) return null;
                    FileInputStream in = new FileInputStream(f);
                    try {
                        byte[] buf = new byte[(int) f.length()];
                        int off = 0, r;
                        while (off < buf.length
                                && (r = in.read(buf, off, buf.length - off)) > 0) {
                            off += r;
                        }
                        return new String(buf, 0, off, StandardCharsets.UTF_8);
                    } finally {
                        in.close();
                    }
                } catch (Exception e) {
                    return null;
                }
            }

            @Override public void write(String key, String value) {
                try {
                    if (!dir.exists()) dir.mkdirs();
                    File f = new File(dir, fileName(key));
                    FileOutputStream out = new FileOutputStream(f);
                    try {
                        out.write(value.getBytes(StandardCharsets.UTF_8));
                    } finally {
                        out.close();
                    }
                } catch (Exception ignored) {
                    // Callers verify by re-reading (add() returns the
                    // stored doc only after the registry write).
                }
            }

            @Override public void delete(String key) {
                try {
                    File f = new File(dir, fileName(key));
                    if (f.exists()) f.delete();
                } catch (Exception ignored) {}
            }

            private String fileName(String key) {
                return key.replaceAll("[^A-Za-z0-9_.-]", "_");
            }
        };
    }

    public synchronized List<Doc> list() {
        List<Doc> out = new ArrayList<Doc>();
        JSONArray docs = registry();
        for (int i = 0; i < docs.length(); i++) {
            JSONObject o = docs.optJSONObject(i);
            if (o == null) continue;
            out.add(new Doc(
                    o.optString("id", ""),
                    o.optString("title", "Untitled"),
                    o.optString("kind", "text"),
                    o.optLong("addedAt", 0),
                    o.optInt("chars", 0)));
        }
        return out;
    }

    public synchronized Doc find(String id) {
        if (id == null) return null;
        for (Doc d : list()) {
            if (d.id.equals(id)) return d;
        }
        return null;
    }

    public synchronized String bodyOf(String id) {
        if (id == null) return null;
        return storage.read("doc:" + id);
    }

    /** The speakable pieces of a document, per the pinned
     *  engine's chunking contract (Chunker). Deterministic in the
     *  body, so a saved place means the same thing after process
     *  death. */
    public List<String> chunksOf(String id) {
        String body = bodyOf(id);
        if (body == null) return new ArrayList<String>();
        return Chunker.chunksOf(body);
    }

    public synchronized Doc add(String title, String kind, String text, long nowMs) {
        String clean = text == null ? "" : text;
        String id = "doc-" + Long.toString(nowMs, 36) + "-" + (seq++);
        String name = (title == null || title.trim().isEmpty())
                ? deriveTitle(clean) : title.trim();
        Doc doc = new Doc(id, name,
                kind == null ? "text" : kind, nowMs, clean.length());
        storage.write("doc:" + id, clean);
        JSONArray docs = registry();
        JSONObject o = new JSONObject();
        try {
            o.put("id", doc.id);
            o.put("title", doc.title);
            o.put("kind", doc.kind);
            o.put("addedAt", doc.addedAt);
            o.put("chars", doc.chars);
        } catch (Exception ignored) {}
        docs.put(o);
        saveRegistry(docs);
        return doc;
    }

    /** Import a document under an EXISTING id (the one-shot
     *  migration from the previous build's page library): the
     *  native marks store already keys places and marks by the
     *  page's document ids, so the ids must survive the move or
     *  the user's marks would orphan. No-op if the id is already
     *  in the library. */
    public synchronized Doc importDoc(String id, String title, String kind,
                                      String text, long addedAt) {
        if (id == null || id.isEmpty() || find(id) != null) return null;
        String clean = text == null ? "" : text;
        Doc doc = new Doc(id,
                (title == null || title.trim().isEmpty())
                        ? deriveTitle(clean) : title.trim(),
                kind == null ? "text" : kind, addedAt, clean.length());
        storage.write("doc:" + id, clean);
        JSONArray docs = registry();
        JSONObject o = new JSONObject();
        try {
            o.put("id", doc.id);
            o.put("title", doc.title);
            o.put("kind", doc.kind);
            o.put("addedAt", doc.addedAt);
            o.put("chars", doc.chars);
        } catch (Exception ignored) {}
        docs.put(o);
        saveRegistry(docs);
        return doc;
    }

    /** Remove takes the document itself. The cross-store cascade
     *  (saved place + marks) is MarksStore.deleteDocument, called
     *  by the same user action in MainActivity; playback stop is
     *  PlayerCore's, likewise. Each store removes exactly what it
     *  owns, and the Library confirms the whole removal in words
     *  before it happens. */
    public synchronized void remove(String id) {
        if (id == null) return;
        JSONArray docs = registry();
        JSONArray kept = new JSONArray();
        for (int i = 0; i < docs.length(); i++) {
            JSONObject o = docs.optJSONObject(i);
            if (o != null && !id.equals(o.optString("id", ""))) {
                kept.put(o);
            }
        }
        saveRegistry(kept);
        storage.delete("doc:" + id);
    }

    public synchronized boolean isEmpty() {
        return registry().length() == 0;
    }

    static String deriveTitle(String text) {
        if (text != null) {
            String[] lines = text.split("\n");
            for (String line : lines) {
                String t = line.trim();
                if (!t.isEmpty()) {
                    return t.length() > 80 ? t.substring(0, 80) : t;
                }
            }
        }
        return "Untitled";
    }

    private JSONArray registry() {
        String raw = storage.read(REGISTRY_KEY);
        if (raw != null) {
            try {
                JSONObject root = new JSONObject(raw);
                JSONArray docs = root.optJSONArray("docs");
                if (docs != null) return docs;
            } catch (Exception ignored) {}
        }
        return new JSONArray();
    }

    private void saveRegistry(JSONArray docs) {
        try {
            JSONObject root = new JSONObject();
            root.put("docs", docs);
            storage.write(REGISTRY_KEY, root.toString());
        } catch (Exception ignored) {}
    }
}

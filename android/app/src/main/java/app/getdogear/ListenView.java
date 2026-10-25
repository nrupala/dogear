package app.getdogear;

import android.content.Context;
import android.graphics.Typeface;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.List;

/**
 * LISTEN (usage) — the open document, rendered natively, and
 * nothing else: no model shelf, no plan, no administration
 * (Phase 1 area law). The document's chunks are paragraphs; the
 * sounding chunk is highlighted; tapping a paragraph asks the
 * core to read from there. Under the document, the open
 * document's marks are listed (what the self-model promises).
 * The control bar lives below this view, in the same area.
 */
public final class ListenView extends ScrollView {

    private final Shell shell;
    private final LinearLayout body;
    private final TextView noteLine;
    private String renderedDocId;
    private List<String> renderedChunks;
    private TextView[] chunkViews;
    private int highlighted = -1;
    private final LinearLayout marksBox;

    public ListenView(Context ctx, Shell shell) {
        super(ctx);
        this.shell = shell;
        body = new LinearLayout(ctx);
        body.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        body.setPadding(pad, pad, pad, pad);
        addView(body);
        noteLine = text("", 13, 0xFF8A4B00);
        noteLine.setVisibility(GONE);
        body.addView(noteLine);
        marksBox = new LinearLayout(ctx);
        marksBox.setOrientation(LinearLayout.VERTICAL);
        body.addView(marksBox);
        renderEmpty();
    }

    /** A transient, visible note (e.g. a feed defect) — spoken
     *  failures use the Announcer; this line is for the surface. */
    public void setNote(String note) {
        if (note == null || note.isEmpty()) {
            noteLine.setVisibility(GONE);
            return;
        }
        noteLine.setText(note);
        noteLine.setVisibility(VISIBLE);
    }

    public void renderEmpty() {
        renderedDocId = null;
        renderedChunks = null;
        chunkViews = null;
        highlighted = -1;
        clearChunks();
        TextView msg = text("Nothing is open. Choose a document from the "
                + "Library and it will be read aloud here.", 16, 0xFF10243E);
        body.addView(msg, 1);
        Button open = new Button(getContext());
        open.setText("Open the Library");
        open.setAllCaps(false);
        open.setOnClickListener(v -> shell.showArea(Shell.AREA_LIBRARY));
        body.addView(open, 2);
    }

    public void renderDocument(String docId, String title, List<String> chunks) {
        if (docId != null && docId.equals(renderedDocId)
                && renderedChunks != null
                && renderedChunks.size() == chunks.size()) {
            return; // same document; highlight moves via renderState
        }
        renderedDocId = docId;
        renderedChunks = chunks;
        highlighted = -1;
        clearChunks();
        TextView head = text(title == null ? "Your document" : title, 19,
                0xFF10243E);
        head.setTypeface(null, Typeface.BOLD);
        body.addView(head, 1);
        chunkViews = new TextView[chunks.size()];
        for (int i = 0; i < chunks.size(); i++) {
            final int idx = i;
            TextView tv = text(chunks.get(i), 16, 0xFF10243E);
            tv.setPadding(dp(8), dp(6), dp(8), dp(6));
            tv.setOnClickListener(v -> {
                // Tap a paragraph to read from there: the host
                // re-seeds the session at that chunk and the
                // feeder follows the core's state.
                shell.steerToChunk(idx);
            });
            chunkViews[i] = tv;
            body.addView(tv, 2 + i);
        }
        renderMarks(docId);
    }

    public void renderState(JSONObject snapshot) {
        if (renderedDocId == null || chunkViews == null) return;
        String doc = snapshot.isNull("docId")
                ? null : snapshot.optString("docId", null);
        if (doc == null || !doc.equals(renderedDocId)) return;
        int chunk = snapshot.optInt("chunk", -1);
        if (chunk == highlighted || chunk < 0 || chunk >= chunkViews.length) {
            return;
        }
        if (highlighted >= 0 && highlighted < chunkViews.length) {
            chunkViews[highlighted].setBackgroundColor(0x00000000);
            chunkViews[highlighted].setTypeface(null, Typeface.NORMAL);
        }
        highlighted = chunk;
        chunkViews[chunk].setBackgroundColor(0xFFDCEBFD);
        chunkViews[chunk].setTypeface(null, Typeface.BOLD);
        final TextView target = chunkViews[chunk];
        post(() -> {
            int y = target.getTop() - dp(40);
            smoothScrollTo(0, Math.max(0, y));
        });
    }

    public void renderMarks(String docId) {
        marksBox.removeAllViews();
        if (docId == null) return;
        JSONObject marks = shell.core().marksFor(docId);
        JSONArray bookmarks = marks.optJSONArray("bookmarks");
        JSONArray tags = marks.optJSONArray("tags");
        JSONArray notes = marks.optJSONArray("notes");
        int count = (bookmarks == null ? 0 : bookmarks.length())
                + (tags == null ? 0 : tags.length())
                + (notes == null ? 0 : notes.length());
        if (count == 0) return;
        TextView head = text("Your marks", 15, 0xFF10243E);
        head.setTypeface(null, Typeface.BOLD);
        head.setPadding(0, dp(16), 0, dp(4));
        marksBox.addView(head);
        if (bookmarks != null) {
            for (int i = 0; i < bookmarks.length(); i++) {
                JSONObject b = bookmarks.optJSONObject(i);
                if (b == null) continue;
                String label = b.optString("label", "");
                marksBox.addView(text("\uD83D\uDD16 Bookmark · part "
                        + (b.optInt("chunk", 0) + 1)
                        + (label.isEmpty() ? "" : " · " + label),
                        14, 0xFF33475B));
            }
        }
        if (tags != null) {
            for (int i = 0; i < tags.length(); i++) {
                JSONObject t = tags.optJSONObject(i);
                if (t == null) continue;
                marksBox.addView(text("\uD83C\uDFF7 Tag · part "
                        + (t.optInt("chunk", 0) + 1) + " · "
                        + t.optString("tag", ""), 14, 0xFF33475B));
            }
        }
        if (notes != null) {
            for (int i = 0; i < notes.length(); i++) {
                JSONObject n = notes.optJSONObject(i);
                if (n == null) continue;
                marksBox.addView(text("\uD83D\uDCDD Note · part "
                        + (n.optInt("chunk", 0) + 1) + " · "
                        + n.optString("text", ""), 14, 0xFF33475B));
            }
        }
    }

    private void clearChunks() {
        // Keep noteLine (index 0) and marksBox (last child).
        while (body.getChildCount() > 2) {
            body.removeViewAt(1);
        }
        marksBox.removeAllViews();
    }

    private TextView text(String s, int sp, int color) {
        TextView tv = new TextView(getContext());
        tv.setText(s);
        tv.setTextSize(sp);
        tv.setTextColor(color);
        tv.setLineSpacing(0, 1.25f);
        return tv;
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}

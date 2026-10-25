package app.getdogear;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Typeface;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * LIBRARY (program) — what exists, where each thing stands, and
 * the two moves that change the set: Add and Remove (Phase 1 area
 * law). Add is prominent and always visible, with the paste route
 * labelled as the second way in. Remove lives on each row, behind
 * a confirmation that names exactly what goes — the document,
 * its saved place, bookmarks, tags and notes — because that is
 * exactly what the removal takes.
 */
public final class LibraryView extends LinearLayout {

    private final Shell shell;
    private final LinearLayout rows;
    private final Map<String, Integer> partCounts = new HashMap<String, Integer>();

    public LibraryView(Context ctx, Shell shell) {
        super(ctx);
        this.shell = shell;
        setOrientation(VERTICAL);
        int pad = dp(16);

        LinearLayout header = new LinearLayout(ctx);
        header.setOrientation(HORIZONTAL);
        header.setPadding(pad, pad, pad, dp(4));
        TextView title = new TextView(ctx);
        title.setText("Library");
        title.setTextSize(20);
        title.setTypeface(null, Typeface.BOLD);
        title.setTextColor(0xFF10243E);
        header.addView(title, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        Button add = new Button(ctx);
        add.setText("Add document");
        add.setAllCaps(false);
        add.setOnClickListener(v -> shell.pickDocumentFile());
        header.addView(add);
        addView(header);

        Button paste = new Button(ctx);
        paste.setText("Paste text instead");
        paste.setAllCaps(false);
        LayoutParams plp = new LayoutParams(LayoutParams.MATCH_PARENT,
                LayoutParams.WRAP_CONTENT);
        plp.setMargins(pad, 0, pad, dp(4));
        paste.setLayoutParams(plp);
        paste.setOnClickListener(v -> pasteDialog());
        addView(paste);

        ScrollView scroll = new ScrollView(ctx);
        rows = new LinearLayout(ctx);
        rows.setOrientation(VERTICAL);
        rows.setPadding(pad, dp(4), pad, pad);
        scroll.addView(rows);
        addView(scroll, new LayoutParams(LayoutParams.MATCH_PARENT, 0, 1f));
    }

    public void refresh() {
        rows.removeAllViews();
        List<DocumentStore.Doc> docs = shell.documents().list();
        if (docs.isEmpty()) {
            TextView empty = new TextView(getContext());
            empty.setText("No documents yet. Add one \u2014 a text file, or "
                    + "paste text \u2014 and DogEar will read it aloud.");
            empty.setTextSize(15);
            empty.setTextColor(0xFF33475B);
            rows.addView(empty);
            return;
        }
        // Newest first.
        for (int i = docs.size() - 1; i >= 0; i--) {
            rows.addView(rowFor(docs.get(i)));
        }
    }

    private View rowFor(final DocumentStore.Doc doc) {
        LinearLayout row = new LinearLayout(getContext());
        row.setOrientation(HORIZONTAL);
        row.setPadding(0, dp(8), 0, dp(8));

        LinearLayout main = new LinearLayout(getContext());
        main.setOrientation(VERTICAL);
        TextView title = new TextView(getContext());
        title.setText(doc.title);
        title.setTextSize(16);
        title.setTypeface(null, Typeface.BOLD);
        title.setTextColor(0xFF10243E);
        main.addView(title);
        TextView meta = new TextView(getContext());
        meta.setText(metaLine(doc));
        meta.setTextSize(13);
        meta.setTextColor(0xFF5A6B7F);
        main.addView(meta);
        main.setOnClickListener(v -> shell.openDocument(doc.id));
        row.addView(main, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));

        Button menu = new Button(getContext());
        menu.setText("\u22EE");
        menu.setAllCaps(false);
        menu.setOnClickListener(v -> rowMenu(doc));
        row.addView(menu);
        return row;
    }

    private String metaLine(DocumentStore.Doc doc) {
        int parts = partCount(doc);
        StringBuilder sb = new StringBuilder();
        sb.append(parts).append(parts == 1 ? " part" : " parts");
        JSONObject saved = shell.marks().savedFor(doc.id);
        JSONObject live = shell.marks().positionFor(doc.id);
        JSONObject place = saved != null ? saved : live;
        if (place != null) {
            sb.append(" \u00B7 part ").append(place.optInt("chunk", 0) + 1)
                    .append(" of ").append(Math.max(parts, place.optInt("chunks", 0)));
            if (saved != null) sb.append(" \u00B7 saved");
        }
        if (shell.marks().isFavorite(doc.id)) sb.append(" \u00B7 \u2605");
        return sb.toString();
    }

    private int partCount(DocumentStore.Doc doc) {
        String key = doc.id + ":" + doc.chars;
        Integer cached = partCounts.get(key);
        if (cached != null) return cached;
        int n = shell.documents().chunksOf(doc.id).size();
        partCounts.put(key, n);
        return n;
    }

    private void rowMenu(final DocumentStore.Doc doc) {
        new AlertDialog.Builder(getContext())
                .setTitle(doc.title)
                .setItems(new String[]{"Open", "Remove\u2026"},
                        (d, which) -> {
                            if (which == 0) shell.openDocument(doc.id);
                            else confirmRemove(doc);
                        })
                .show();
    }

    private void confirmRemove(final DocumentStore.Doc doc) {
        new AlertDialog.Builder(getContext())
                .setTitle("Remove this document?")
                .setMessage("\u201C" + doc.title + "\u201D will be removed. "
                        + "The document, its saved place, bookmarks, tags "
                        + "and notes are removed. This cannot be undone.")
                .setNegativeButton("Keep it", null)
                .setPositiveButton("Remove", (d, w) -> {
                    shell.removeDocument(doc.id);
                    refresh();
                })
                .show();
    }

    private void pasteDialog() {
        LinearLayout box = new LinearLayout(getContext());
        box.setOrientation(VERTICAL);
        int pad = dp(16);
        box.setPadding(pad, pad, pad, 0);
        final EditText titleIn = new EditText(getContext());
        titleIn.setHint("Title (optional)");
        box.addView(titleIn);
        final EditText textIn = new EditText(getContext());
        textIn.setHint("Paste the text to read aloud");
        textIn.setMinLines(5);
        box.addView(textIn);
        new AlertDialog.Builder(getContext())
                .setTitle("Add pasted text")
                .setView(box)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Add", (d, w) -> {
                    String text = textIn.getText().toString();
                    if (text.trim().isEmpty()) return;
                    shell.addPastedText(titleIn.getText().toString(), text);
                    refresh();
                })
                .show();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}

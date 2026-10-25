package app.getdogear;

import android.app.AlertDialog;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
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
        /* Depth (Build E): the Library sits on the app GROUND;
           its documents stand on it as cards (below). */
        setBackgroundColor(0xFFE9EFF6);
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
        /* The one loud action on this surface carries the
           accent, like Play does on the bar. */
        add.setTypeface(null, Typeface.BOLD);
        add.setTextColor(0xFFFFFFFF);
        add.setBackgroundTintList(ColorStateList.valueOf(0xFF175C4C));
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
        row.setPadding(dp(14), dp(10), dp(10), dp(10));
        /* Depth (Build E, owner doctrine 2026-10-24 23:38):
           a document row is a CARD on the Library's ground —
           white, rounded, elevated — an object on a shelf,
           not a line in a flat list. */
        GradientDrawable card = new GradientDrawable();
        card.setColor(0xFFFFFFFF);
        card.setCornerRadius(dp(12));
        row.setBackground(card);
        row.setElevation(dp(3));
        LayoutParams rlp = new LayoutParams(LayoutParams.MATCH_PARENT,
                LayoutParams.WRAP_CONTENT);
        rlp.setMargins(0, 0, 0, dp(10));
        row.setLayoutParams(rlp);

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
        /* Build F (U-4): the WHOLE card opens the document,
           not only its text column. On Build E the card's
           padding bands (left of the title, below the meta
           line, right of the text) were inert — a tap there,
           in any playback state, did nothing at all, and the
           seat's row tap "while paused" died in that dead
           zone. The card is one object; every part of it
           answers. (Options keeps its own tap; it consumes
           it before the row sees it.) */
        row.setOnClickListener(v -> shell.openDocument(doc.id));
        row.addView(main, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));

        /* W-4 (Build D, from the L13 fresh-eyes walk): removal
           hid behind an unlabeled ⋮ glyph — a first-time user
           had to guess that the icon was the path. The button
           now carries a visible word, and its accessible name
           says whose options they are. The menu it opens keeps
           its labeled items ("Open", "Remove…"). */
        Button menu = new Button(getContext());
        menu.setText("Options");
        menu.setAllCaps(false);
        menu.setContentDescription("Options for " + doc.title);
        /* Depth (Build F, Q-4): in-card controls carry the
           shared language — light rounded face, small
           elevation of their own — not a flat default slab
           sitting on an elevated card. */
        GradientDrawable obg = new GradientDrawable();
        obg.setColor(0xFFEAF3FE);
        obg.setCornerRadius(dp(10));
        menu.setBackground(obg);
        menu.setElevation(dp(2));
        menu.setTextColor(0xFF10243E);
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
        /* W-3 (Build D): a document's bookmarks are countable
           from the Library too — the marks are findable from
           both areas, not only stored. */
        org.json.JSONArray bms = shell.core().marksFor(doc.id)
                .optJSONArray("bookmarks");
        int nb = bms == null ? 0 : bms.length();
        if (nb > 0) {
            sb.append(" \u00B7 ").append(nb)
                    .append(nb == 1 ? " bookmark" : " bookmarks");
        }
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
        /* Build H (QUALITY baseline B4): height discipline.
           The Title field was a free-growing multi-line field —
           text wrapping in it pushed the dialog's actions off
           the bottom of the screen, unreachable (and the IME
           covered the body field besides). A title is one line;
           the body is capped and scrolls inside itself, so
           Cancel and Add are ALWAYS on screen. */
        titleIn.setSingleLine(true);
        box.addView(titleIn);
        final EditText textIn = new EditText(getContext());
        textIn.setHint("Paste the text to read aloud");
        textIn.setMinLines(5);
        textIn.setMaxLines(8);
        textIn.setVerticalScrollBarEnabled(true);
        box.addView(textIn);
        /* Build I (Q-H1, the general law): no typed content
           is silently discarded anywhere in the app. Through
           Build H2, ADD on an empty body closed this dialog
           and took a typed title with it — no document, no
           word, the typing simply gone (the QUALITY seat,
           twice). The dialog now answers a blocked ADD in
           place: it STANDS, the title stays in its field,
           and the reason is written under the body in a line
           whose space is reserved from the first frame. The
           platform's button still dismisses on its own
           schedule, so Add's handler is wired after the
           dialog stands (the standard keep-open pattern) and
           dismissal is this code's decision, not a default. */
        final TextView reason = new TextView(getContext());
        reason.setTextSize(13);
        reason.setTextColor(0xFF8A4B00);
        reason.setMinHeight(dp(20));
        reason.setText("");
        box.addView(reason);
        final AlertDialog[] holder = new AlertDialog[1];
        holder[0] = new AlertDialog.Builder(getContext())
                .setTitle("Add pasted text")
                .setView(box)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Add", null)
                .create();
        holder[0].setOnShowListener(x -> holder[0].getButton(
                AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            String text = textIn.getText().toString();
            if (text.trim().isEmpty()) {
                reason.setText("Paste the text to read aloud first "
                        + "\u2014 your title is kept; nothing was added.");
                return;
            }
            shell.addPastedText(titleIn.getText().toString(), text);
            refresh();
            holder[0].dismiss();
        }));
        holder[0].show();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}

package app.getdogear;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.Window;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The MARKS sheet (Build E — Seat B): the five mark actions
 * (Save place · Bookmark · Favorite · Tag · Note) and every
 * saved mark for the open document, behind ONE labelled
 * "Marks" button on the control bar. The sheet rises over
 * the page (owner depth doctrine, 2026-10-24 23:38): a
 * rounded-top panel on a dimmed ground.
 *
 * Seat B's reason, on the record: Build C's fresh-eyes walk
 * failed on W-2 (Save place confirmed nothing) and W-3 (a
 * saved bookmark could not be found again). The sheet is the
 * structural fix, not a cosmetic one: every act confirms IN
 * PLACE in this sheet ("Place saved — part 12"), and every
 * mark is listed here — kind, part, label — tappable to jump
 * to its place. The sheet owns no truth: it renders the
 * core's marks and re-renders when the core reports a change
 * (the host calls refresh() on the core's marks event).
 */
public final class MarksSheet {

    public interface Host {
        /** Jump the reading to a mark's chunk (the host steers
         *  the session, exactly as a paragraph tap does). */
        void steerToChunk(int chunk);
    }

    private final Activity activity;
    private final PlayerCore core;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());

    private Dialog dialog;
    private LinearLayout listBox;
    private TextView confirmLine;
    private TextView titleLine;
    private String docId;

    public MarksSheet(Activity activity, PlayerCore core, Host host) {
        this.activity = activity;
        this.core = core;
        this.host = host;
    }

    public boolean isShowing() {
        return dialog != null && dialog.isShowing();
    }

    public void dismiss() {
        if (dialog != null) dialog.dismiss();
    }

    public void show(String forDocId) {
        docId = forDocId;
        if (dialog != null && dialog.isShowing()) {
            refresh();
            return;
        }
        build();
        dialog.show();
        refresh();
    }

    private void build() {
        LinearLayout panel = new LinearLayout(activity);
        panel.setOrientation(LinearLayout.VERTICAL);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(Color.WHITE);
        bg.setCornerRadii(new float[]{
                dp(20), dp(20), dp(20), dp(20), 0, 0, 0, 0});
        panel.setBackground(bg);
        panel.setElevation(dp(24));
        panel.setPadding(dp(20), dp(10), dp(20), dp(20));

        /* The grab pill: the sheet reads as an object that
           rose over the page, not a dialog that replaced it. */
        View pill = new View(activity);
        GradientDrawable pillBg = new GradientDrawable();
        pillBg.setColor(0xFFC9D6E4);
        pillBg.setCornerRadius(dp(3));
        pill.setBackground(pillBg);
        LinearLayout.LayoutParams plp = new LinearLayout.LayoutParams(dp(44), dp(5));
        plp.gravity = Gravity.CENTER_HORIZONTAL;
        plp.setMargins(0, dp(2), 0, dp(12));
        pill.setLayoutParams(plp);
        panel.addView(pill);

        titleLine = new TextView(activity);
        titleLine.setTextSize(17);
        titleLine.setTypeface(null, android.graphics.Typeface.BOLD);
        titleLine.setTextColor(0xFF10243E);
        panel.addView(titleLine);

        confirmLine = new TextView(activity);
        confirmLine.setTextSize(14);
        confirmLine.setTextColor(0xFF175C4C);
        confirmLine.setPadding(0, dp(6), 0, 0);
        confirmLine.setVisibility(View.GONE);
        panel.addView(confirmLine);

        panel.addView(actionButton("Save place", v -> {
            core.savePlace(PlayerCore.Source.BAR);
            afterAct("Place saved");
        }));
        panel.addView(actionButton("Bookmark\u2026", v -> bookmarkDialog()));
        panel.addView(actionButton("Favorite", v -> {
            core.toggleFavorite(PlayerCore.Source.BAR);
            afterAct(null);
        }));
        panel.addView(actionButton("Tag\u2026", v -> tagDialog()));
        panel.addView(actionButton("Note\u2026", v -> noteDialog()));

        ScrollView scroll = new ScrollView(activity);
        listBox = new LinearLayout(activity);
        listBox.setOrientation(LinearLayout.VERTICAL);
        scroll.addView(listBox);
        LinearLayout.LayoutParams slp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        slp.setMargins(0, dp(8), 0, 0);
        scroll.setLayoutParams(slp);
        panel.addView(scroll);

        dialog = new Dialog(activity);
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        dialog.setContentView(panel);
        Window w = dialog.getWindow();
        if (w != null) {
            w.setGravity(Gravity.BOTTOM);
            w.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
        }
        dialog.setOnShowListener(d -> {
            Window win = dialog.getWindow();
            if (win != null) {
                win.setLayout(LinearLayout.LayoutParams.MATCH_PARENT,
                        LinearLayout.LayoutParams.WRAP_CONTENT);
            }
        });
        dialog.setOnDismissListener(d -> dialog = null);
    }

    private Button actionButton(String label, View.OnClickListener onClick) {
        Button b = new Button(activity);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(15f);
        b.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        b.setOnClickListener(onClick);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        lp.setMargins(0, dp(6), 0, 0);
        b.setLayoutParams(lp);
        return b;
    }

    /** After an act, the core's new truth lands a beat later
     *  (its verbs are queued): re-render from the snapshot and
     *  the marks, and say what happened IN PLACE. */
    private void afterAct(final String what) {
        main.postDelayed(() -> {
            if (!isShowing()) return;
            JSONObject snap = core.snapshot();
            int chunk = snap.optInt("chunk", -1);
            String msg = what;
            if ("Place saved".equals(what)) {
                int saved = snap.optInt("savedChunk", -1);
                msg = "Place saved \u2014 part " + (saved >= 0 ? saved + 1
                        : chunk + 1);
            } else if (what == null) {
                msg = snap.optBoolean("favorite", false)
                        ? "Added to favorites" : "Removed from favorites";
            } else if (chunk >= 0) {
                msg = what + " \u2014 part " + (chunk + 1);
            }
            confirmLine.setText(msg);
            confirmLine.setVisibility(View.VISIBLE);
            refresh();
        }, 200);
    }

    // ------------------------------------------------------------------
    // Rendering — from the core's marks, never the sheet's memory
    // ------------------------------------------------------------------

    public void refresh() {
        if (dialog == null || listBox == null || docId == null) return;
        JSONObject snap = core.snapshot();
        String title = snap.optString("title", "");
        titleLine.setText("Marks" + (title.isEmpty() ? "" : " \u2014 " + title));

        listBox.removeAllViews();
        JSONObject marks = core.marksFor(docId);
        JSONObject pin = marks.optJSONObject("saved");
        JSONArray bookmarks = marks.optJSONArray("bookmarks");
        JSONArray tags = marks.optJSONArray("tags");
        JSONArray notes = marks.optJSONArray("notes");
        int count = (pin == null ? 0 : 1)
                + (bookmarks == null ? 0 : bookmarks.length())
                + (tags == null ? 0 : tags.length())
                + (notes == null ? 0 : notes.length());

        TextView head = new TextView(activity);
        head.setTextSize(14);
        head.setTypeface(null, android.graphics.Typeface.BOLD);
        head.setTextColor(0xFF10243E);
        head.setPadding(0, dp(10), 0, dp(4));
        head.setText(count == 0
                ? "No marks yet \u2014 save a place, or bookmark, tag "
                        + "and note the parts that matter."
                : "Your marks (" + count + ") \u2014 tap one to go to its place");
        listBox.addView(head);

        if (pin != null) {
            listBox.addView(markRow("\uD83D\uDCCC Saved place \u00B7 part "
                    + (pin.optInt("chunk", 0) + 1), pin.optInt("chunk", 0)));
        }
        if (bookmarks != null) {
            for (int i = 0; i < bookmarks.length(); i++) {
                JSONObject b = bookmarks.optJSONObject(i);
                if (b == null) continue;
                String label = b.optString("label", "");
                listBox.addView(markRow("\uD83D\uDD16 Bookmark \u00B7 part "
                        + (b.optInt("chunk", 0) + 1)
                        + (label.isEmpty() ? "" : " \u00B7 " + label),
                        b.optInt("chunk", 0)));
            }
        }
        if (tags != null) {
            for (int i = 0; i < tags.length(); i++) {
                JSONObject t = tags.optJSONObject(i);
                if (t == null) continue;
                listBox.addView(markRow("\uD83C\uDFF7 Tag \u00B7 part "
                        + (t.optInt("chunk", 0) + 1) + " \u00B7 "
                        + t.optString("tag", ""), t.optInt("chunk", 0)));
            }
        }
        if (notes != null) {
            for (int i = 0; i < notes.length(); i++) {
                JSONObject n = notes.optJSONObject(i);
                if (n == null) continue;
                listBox.addView(markRow("\uD83D\uDCDD Note \u00B7 part "
                        + (n.optInt("chunk", 0) + 1) + " \u00B7 "
                        + n.optString("text", ""), n.optInt("chunk", 0)));
            }
        }
    }

    private TextView markRow(String label, final int chunk) {
        TextView tv = new TextView(activity);
        tv.setText(label);
        tv.setTextSize(14);
        tv.setTextColor(0xFF33475B);
        tv.setPadding(dp(10), dp(9), dp(10), dp(9));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFFEAF3FE);
        bg.setCornerRadius(dp(8));
        tv.setBackground(bg);
        tv.setOnClickListener(v -> {
            dismiss();
            host.steerToChunk(chunk);
        });
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.setMargins(0, 0, 0, dp(5));
        tv.setLayoutParams(lp);
        return tv;
    }

    // ------------------------------------------------------------------
    // The text-bearing acts (moved from the control bar, unchanged)
    // ------------------------------------------------------------------

    private void bookmarkDialog() {
        final EditText input = new EditText(activity);
        input.setHint("Label (optional)");
        input.setTextColor(Color.BLACK);
        new AlertDialog.Builder(activity)
                .setTitle("Bookmark this place")
                .setView(input)
                .setPositiveButton("Save", (d, w) -> {
                    core.addBookmark(input.getText().toString(), PlayerCore.Source.BAR);
                    afterAct("Bookmark saved");
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void tagDialog() {
        final EditText input = new EditText(activity);
        input.setHint("Tag name");
        input.setTextColor(Color.BLACK);
        new AlertDialog.Builder(activity)
                .setTitle("Tag this document")
                .setView(input)
                .setPositiveButton("Add tag", (d, w) -> {
                    core.addTag(input.getText().toString(), PlayerCore.Source.BAR);
                    afterAct("Tag added");
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void noteDialog() {
        final EditText input = new EditText(activity);
        input.setHint("Your note, saved at this place in the reading");
        input.setTextColor(Color.BLACK);
        input.setMinLines(2);
        input.setGravity(Gravity.TOP);
        new AlertDialog.Builder(activity)
                .setTitle("Note at this place")
                .setView(input)
                .setPositiveButton("Save note", (d, w) -> {
                    core.addNote(input.getText().toString(), PlayerCore.Source.BAR);
                    afterAct("Note saved");
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private int dp(int v) {
        return Math.round(v * activity.getResources().getDisplayMetrics().density);
    }
}

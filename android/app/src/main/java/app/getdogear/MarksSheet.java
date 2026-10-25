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
import android.view.WindowManager;
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
    private ScrollView scrollBox;
    private LinearLayout listBox;
    private TextView confirmLine;
    private TextView titleLine;
    private String docId;
    /* Build F (U-3): the sheet's window ends ABOVE the app's
       navigation bar — the host measures the nav (plus the
       system-bar inset under it) and passes the total; the
       sheet's bottom edge sits on the nav's top edge, so no
       mark row ever renders over the Library|Settings band
       again (on Build E the sheet's lowest row overlapped the
       nav band and a tap there could switch areas). */
    private int bottomInsetPx = 0;

    public MarksSheet(Activity activity, PlayerCore core, Host host) {
        this.activity = activity;
        this.core = core;
        this.host = host;
    }

    public void setBottomInsetPx(int px) {
        bottomInsetPx = Math.max(0, px);
        applyWindowGeometry();
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
        /* Build F (U-2): the content is FULLY populated before
           the window shows — title, marks list, everything the
           first layout needs. Build E showed first and filled
           after: the window grew upward as content landed and
           the action buttons moved after they were already
           visible and tappable, so a tap aimed at one button
           landed on its neighbour. Stationary from the moment
           they are tappable is the law now. */
        refresh();
        dialog.show();
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
        /* Build F (U-2): the confirm line's space is RESERVED
           from the first layout (it used to flip GONE→VISIBLE
           200 ms after an act, growing the sheet under the
           user's next aim). It stands empty until it has
           something to say; its height never changes. */
        confirmLine.setMinHeight(dp(26));
        confirmLine.setText("");
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
        scrollBox = scroll;
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
            /* Build F (U-2): NO window enter/exit animation.
               The platform's default dialog animation moves
               the sheet while it is already tappable — the
               position a user SEES mid-settle is not the
               position the tap tests against, which is how a
               tap aimed at "Save place" landed on "Bookmark".
               The sheet now appears in its final place at once;
               its depth read comes from the scrim, the rounded
               top and the elevation, not from motion. */
            w.setWindowAnimations(0);
        }
        dialog.setOnShowListener(d -> applyWindowGeometry());
        dialog.setOnDismissListener(d -> dialog = null);
    }

    /** The sheet's window contract: full width, content
     *  height, bottom edge resting ON the navigation bar's
     *  top edge (U-3), and the marks list height clamped so
     *  the panel can never grow down over the nav band no
     *  matter how many marks the document carries. */
    private void applyWindowGeometry() {
        if (dialog == null) return;
        Window win = dialog.getWindow();
        if (win == null) return;
        WindowManager.LayoutParams lp = win.getAttributes();
        lp.width = WindowManager.LayoutParams.MATCH_PARENT;
        lp.height = WindowManager.LayoutParams.WRAP_CONTENT;
        lp.gravity = Gravity.BOTTOM;
        lp.y = bottomInsetPx;
        win.setAttributes(lp);
        clampListHeight();
    }

    /** The marks list scrolls within a fixed ceiling — the
     *  sheet's total height is bounded by construction, so
     *  its geometry is the same for 0 marks and 50. */
    private void clampListHeight() {
        if (scrollBox == null || listBox == null) return;
        scrollBox.post(() -> {
            if (scrollBox == null || listBox == null) return;
            int max = dp(216);
            int want = listBox.getHeight();
            LinearLayout.LayoutParams lp =
                    (LinearLayout.LayoutParams) scrollBox.getLayoutParams();
            int target = want <= 0 ? LinearLayout.LayoutParams.WRAP_CONTENT
                    : Math.min(want, max);
            if (lp.height != target) {
                lp.height = target;
                scrollBox.setLayoutParams(lp);
            }
        });
    }

    private Button actionButton(String label, View.OnClickListener onClick) {
        Button b = new Button(activity);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(15f);
        b.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        /* Depth (Build F, Q-4): the sheet's actions carry the
           same in-card control language as the Library's and
           the shelf's — a light rounded face with its own
           small elevation — not flat default slabs. */
        GradientDrawable abg = new GradientDrawable();
        abg.setColor(0xFFF2F6FB);
        abg.setCornerRadius(dp(10));
        b.setBackground(abg);
        b.setElevation(dp(2));
        b.setTextColor(0xFF10243E);
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
        clampListHeight();
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

    /* Build H (D-6 residue): a dialog holding TYPED text is
       never dismissed by an outside or empty-space tap. The
       Build G seat evidence (synthesis in the evidence index)
       proved the reported "silent bookmark losses" were
       harness taps landing on stale coordinates after the IME
       moved the dialog — but the product truth underneath them
       stands: one stray tap outside a half-typed label closed
       the dialog and discarded the typing with no trace. The
       text dialogs now close only by their named buttons —
       Save, or an explicit Cancel a person chose. */
    private void showTextDialog(AlertDialog.Builder builder) {
        AlertDialog d = builder.create();
        d.setCanceledOnTouchOutside(false);
        d.show();
    }

    private void bookmarkDialog() {
        final EditText input = new EditText(activity);
        input.setHint("Label (optional)");
        input.setTextColor(Color.BLACK);
        showTextDialog(new AlertDialog.Builder(activity)
                .setTitle("Bookmark this place")
                .setView(input)
                .setPositiveButton("Save", (d, w) -> {
                    core.addBookmark(input.getText().toString(), PlayerCore.Source.BAR);
                    afterAct("Bookmark saved");
                })
                .setNegativeButton("Cancel", null));
    }

    private void tagDialog() {
        final EditText input = new EditText(activity);
        input.setHint("Tag name");
        input.setTextColor(Color.BLACK);
        showTextDialog(new AlertDialog.Builder(activity)
                .setTitle("Tag this document")
                .setView(input)
                .setPositiveButton("Add tag", (d, w) -> {
                    core.addTag(input.getText().toString(), PlayerCore.Source.BAR);
                    afterAct("Tag added");
                })
                .setNegativeButton("Cancel", null));
    }

    private void noteDialog() {
        final EditText input = new EditText(activity);
        input.setHint("Your note, saved at this place in the reading");
        input.setTextColor(Color.BLACK);
        input.setMinLines(2);
        input.setGravity(Gravity.TOP);
        showTextDialog(new AlertDialog.Builder(activity)
                .setTitle("Note at this place")
                .setView(input)
                .setPositiveButton("Save note", (d, w) -> {
                    core.addNote(input.getText().toString(), PlayerCore.Source.BAR);
                    afterAct("Note saved");
                })
                .setNegativeButton("Cancel", null));
    }

    private int dp(int v) {
        return Math.round(v * activity.getResources().getDisplayMetrics().density);
    }
}

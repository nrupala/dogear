package app.getdogear;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

import org.json.JSONObject;

/**
 * DogEar's native control bar (beta.5) — the standing playback
 * surface the owner's phone test demanded. Audible's lesson: the
 * transport is PART OF THE APP, always on screen, answering on the
 * platform's own touch dispatch. This bar is a native Android view
 * docked under the WebView in MainActivity: it is painted by the
 * activity's UI thread and pressable no matter what the page's
 * renderer is doing (the beta.4 failure — DOM buttons queued
 * behind WASM work while the app spoke — cannot happen here).
 *
 * Every button is an idempotent verb on PlayerCore; the bar keeps
 * no state of its own — it renders PlayerCore snapshots. The eight
 * in-playback features the owner named, all live during speech:
 *   transport row: Pause/Resume · Stop · Talk · Continue
 *   marks row:     Save · Bookmark · Favorite · Tag · Note
 */
public final class NativeControlBar extends LinearLayout {

    private final Activity activity;
    private final PlayerCore core;

    private final TextView statusLine;
    private final Button btnPlayPause;
    private final Button btnStop;
    private final Button btnTalk;
    private final Button btnContinue;
    private final Button btnSave;
    private final Button btnBookmark;
    private final Button btnFavorite;
    private final Button btnTag;
    private final Button btnNote;

    private String playback = "none";
    private String voice = "idle";
    private boolean hasDoc = false;

    public NativeControlBar(Activity activity, PlayerCore core) {
        super(activity);
        this.activity = activity;
        this.core = core;
        setOrientation(VERTICAL);
        setBackgroundColor(0xFF0B1B30);
        int pad = dp(10);
        setPadding(pad, dp(6), pad, dp(8));

        /* 1.1.0 finish pass (presentation only — no behavior
           change anywhere in this file's edits): a hairline
           separates the bar from the page above it. */
        View divider = new View(activity);
        divider.setBackgroundColor(0xFF16324F);
        addView(divider, new LayoutParams(LayoutParams.MATCH_PARENT, dp(1)));

        statusLine = new TextView(activity);
        statusLine.setTextColor(0xFFBFD9F7);
        statusLine.setTextSize(13f);
        statusLine.setSingleLine(true);
        statusLine.setEllipsize(android.text.TextUtils.TruncateAt.END);
        statusLine.setText("DogEar — open a document to listen");
        addView(statusLine, new LayoutParams(LayoutParams.MATCH_PARENT, dp(24)));

        LinearLayout transport = row();
        btnPlayPause = button("\u25B6 Play");
        btnStop = button("\u23F9 Stop");
        btnTalk = button("\uD83C\uDFA4 Talk");
        btnContinue = button("\u23F5 Continue");
        /* One obvious primary action (placement law 2): Play
           carries the accent; Talk, the voice primary, carries
           weight. Everything else stays quiet. */
        btnPlayPause.setBackgroundTintList(ColorStateList.valueOf(0xFF175C4C));
        btnPlayPause.setTypeface(null, android.graphics.Typeface.BOLD);
        btnTalk.setTypeface(null, android.graphics.Typeface.BOLD);
        transport.addView(btnPlayPause);
        transport.addView(btnStop);
        transport.addView(btnTalk);
        transport.addView(btnContinue);
        addView(transport);

        LinearLayout marks = row();
        btnSave = button("Save place");
        btnBookmark = button("Bookmark");
        btnFavorite = button("\u2606 Favorite");
        btnTag = button("Tag");
        btnNote = button("Note");
        marks.addView(btnSave);
        marks.addView(btnBookmark);
        marks.addView(btnFavorite);
        marks.addView(btnTag);
        marks.addView(btnNote);
        addView(marks);

        btnPlayPause.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) {
                if ("playing".equals(playback)) {
                    core.pause(PlayerCore.Source.BAR);
                } else if ("paused".equals(playback)) {
                    core.resume(PlayerCore.Source.BAR);
                } else {
                    core.play(PlayerCore.Source.BAR);
                }
            }
        });
        btnStop.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { core.stop(PlayerCore.Source.BAR); }
        });
        btnTalk.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) {
                if ("listening".equals(voice)) core.talkStop();
                else core.talkStart(PlayerCore.Source.BAR);
            }
        });
        btnContinue.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { core.continueSaved(PlayerCore.Source.BAR); }
        });
        btnSave.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { core.savePlace(PlayerCore.Source.BAR); }
        });
        btnBookmark.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { bookmarkDialog(); }
        });
        btnFavorite.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { core.toggleFavorite(PlayerCore.Source.BAR); }
        });
        btnTag.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { tagDialog(); }
        });
        btnNote.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) { noteDialog(); }
        });

        render(core.snapshot());
    }

    private LinearLayout row() {
        LinearLayout r = new LinearLayout(activity);
        r.setOrientation(HORIZONTAL);
        LayoutParams lp = new LayoutParams(LayoutParams.MATCH_PARENT, dp(48));
        lp.topMargin = dp(6);
        r.setLayoutParams(lp);
        return r;
    }

    private Button button(String label) {
        Button b = new Button(activity);
        b.setText(label);
        b.setTextSize(13f);
        /* A disabled button must LOOK disabled (finish pass):
           a single text color made dead buttons identical to
           live ones. State-list colors now carry the state. */
        b.setTextColor(new ColorStateList(
            new int[][] {
                new int[] { android.R.attr.state_enabled },
                new int[] {},
            },
            new int[] { 0xFFEAF3FE, 0xFF7E93AC }));
        b.setAllCaps(false);
        b.setBackgroundTintList(ColorStateList.valueOf(0xFF16324F));
        LayoutParams lp = new LayoutParams(0, LayoutParams.MATCH_PARENT, 1f);
        lp.setMargins(dp(3), 0, dp(3), 0);
        b.setLayoutParams(lp);
        b.setPadding(dp(2), 0, dp(2), 0);
        return b;
    }

    private int dp(int v) {
        return Math.round(v * activity.getResources().getDisplayMetrics().density);
    }

    // ------------------------------------------------------------------
    // Rendering (PlayerCore snapshots only — the bar owns no state)
    // ------------------------------------------------------------------

    public void render(JSONObject s) {
        playback = s.optString("playback", "none");
        voice = s.optString("voice", "idle");
        hasDoc = !s.isNull("docId");
        String title = s.optString("title", "");
        int chunk = s.optInt("chunk", -1);
        int chunks = s.optInt("chunks", 0);
        boolean favorite = s.optBoolean("favorite", false);
        boolean canContinue = s.optBoolean("canContinue", false);

        StringBuilder line = new StringBuilder();
        if (hasDoc && !title.isEmpty()) line.append(title);
        else if (hasDoc) line.append("Your document");
        else line.append("DogEar");
        if ("playing".equals(playback)) line.append(" — reading aloud");
        else if ("paused".equals(playback)) line.append(" — paused");
        else if ("stopped".equals(playback)) line.append(" — stopped");
        if (hasDoc && chunks > 0 && chunk >= 0) {
            line.append(" · part ").append(chunk + 1).append(" of ").append(chunks);
        }
        if ("listening".equals(voice)) line.append(" · listening\u2026");
        statusLine.setText(line.toString());

        if ("playing".equals(playback)) btnPlayPause.setText("\u23F8 Pause");
        else if ("paused".equals(playback)) btnPlayPause.setText("\u25B6 Resume");
        else btnPlayPause.setText("\u25B6 Play");
        btnPlayPause.setEnabled(hasDoc || canContinue);

        btnStop.setEnabled("playing".equals(playback) || "paused".equals(playback));

        if ("listening".equals(voice)) {
            btnTalk.setText("\u23F9 Done");
            btnTalk.setEnabled(true);
        } else if ("processing".equals(voice)) {
            btnTalk.setText("Working\u2026");
            btnTalk.setEnabled(false);
        } else {
            btnTalk.setText("\uD83C\uDFA4 Talk");
            btnTalk.setEnabled(hasDoc);
        }

        btnContinue.setEnabled(canContinue);
        btnSave.setEnabled(hasDoc);
        btnBookmark.setEnabled(hasDoc);
        btnFavorite.setEnabled(hasDoc);
        btnFavorite.setText(favorite ? "\u2605 Favorite" : "\u2606 Favorite");
        /* The active favorite reads gold (finish pass); the
           enabled text color is restored on the core state
           list otherwise. */
        if (favorite) btnFavorite.setTextColor(0xFFFFD166);
        else btnFavorite.setTextColor(new ColorStateList(
            new int[][] {
                new int[] { android.R.attr.state_enabled },
                new int[] {},
            },
            new int[] { 0xFFEAF3FE, 0xFF7E93AC }));
        btnTag.setEnabled(hasDoc);
        btnNote.setEnabled(hasDoc);
    }

    // ------------------------------------------------------------------
    // Mark dialogs (the text-bearing features)
    // ------------------------------------------------------------------

    private void bookmarkDialog() {
        final EditText input = new EditText(activity);
        input.setHint("Label (optional)");
        input.setTextColor(Color.BLACK);
        new AlertDialog.Builder(activity)
                .setTitle("Bookmark this place")
                .setView(input)
                .setPositiveButton("Save", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        core.addBookmark(input.getText().toString(), PlayerCore.Source.BAR);
                    }
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
                .setPositiveButton("Add tag", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        core.addTag(input.getText().toString(), PlayerCore.Source.BAR);
                    }
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
                .setPositiveButton("Save note", new DialogInterface.OnClickListener() {
                    @Override public void onClick(DialogInterface d, int w) {
                        core.addNote(input.getText().toString(), PlayerCore.Source.BAR);
                    }
                })
                .setNegativeButton("Cancel", null)
                .show();
    }
}

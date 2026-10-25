package app.getdogear;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.view.View;
import android.widget.Button;
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
 *   marks (Build E, Seat B): ONE labelled "Marks" button opens
 *   the Marks sheet, where the five mark acts live and every
 *   saved mark is listed and findable (the structural fix for
 *   the Build C walk's W-2/W-3 — the old five-button marks row
 *   confirmed nothing and found nothing).
 */
public final class NativeControlBar extends LinearLayout {

    private final Activity activity;
    private final PlayerCore core;

    private final TextView statusLine;
    private final Button btnPlayPause;
    private final Button btnStop;
    private final Button btnTalk;
    private final Button btnContinue;
    private final Button btnMarks;

    private String playback = "none";
    private String voice = "idle";
    private boolean hasDoc = false;
    private boolean lastCanContinue = false;
    /* Redesign: the empty state's primary action ("Choose a
       document") navigates to the Library; the host wires it. */
    private Runnable chooseDocumentAction;
    /* Build E: the Marks button opens the host's Marks sheet. */
    private Runnable marksAction;
    /* Build E (Seat B delta 4): the host computes time remaining
       truthfully from chunk position + speech rate and pushes
       the label; null means "not shown", never a guess. */
    private String timeRemaining;

    public void setChooseDocumentAction(Runnable action) {
        chooseDocumentAction = action;
        render(core.snapshot());
    }

    public void setMarksAction(Runnable action) {
        marksAction = action;
    }

    /** The marks count the host computed from the core's marks
     *  (pin + bookmarks + tags + notes): the count on the button
     *  is the standing findability signal W-3 demanded. */
    public void setMarksCount(int count) {
        btnMarks.setText(count > 0 ? "Marks (" + count + ")" : "Marks");
    }

    public void setTimeRemaining(String label) {
        timeRemaining = label;
    }

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

        /* Build E (Seat B delta 3): the five-button marks row
           is gone. One labelled Marks button takes its row —
           the acts and the saved marks live in the sheet it
           opens (MarksSheet), where they confirm in place and
           can be found again. */
        LinearLayout marks = row();
        btnMarks = button("Marks");
        btnMarks.setTypeface(null, android.graphics.Typeface.BOLD);
        marks.addView(btnMarks);
        addView(marks);

        btnPlayPause.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) {
                /* Redesign (Phase 0 rule, clause 2): in the empty
                   state the primary button is "Choose a document"
                   and it ACTS — it takes the user to the Library.
                   It is never a dead, disabled Play. */
                if (!hasDoc && !lastCanContinue && chooseDocumentAction != null) {
                    chooseDocumentAction.run();
                    return;
                }
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
        btnMarks.setOnClickListener(new OnClickListener() {
            @Override public void onClick(View v) {
                if (marksAction != null) marksAction.run();
            }
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
        else if (canContinue) line.append("DogEar — a saved place is waiting");
        else line.append("No document open — choose one from the Library");
        if ("playing".equals(playback)) line.append(" — reading aloud");
        else if ("paused".equals(playback)) line.append(" — paused");
        else if ("stopped".equals(playback)) line.append(" — stopped");
        if (hasDoc && chunks > 0 && chunk >= 0) {
            line.append(" · part ").append(chunk + 1).append(" of ").append(chunks);
        }
        /* W-2 (Build D, from the L13 fresh-eyes walk): "Save
           place" confirmed nothing a user could SEE — its only
           feedback was a transient toast, so a fresh user could
           not tell the act had worked. The pin is now standing
           state on the status line, at the point of action,
           rendered from the core's own snapshot (savedChunk is
           the open document's pinned place): press Save and this
           line gains "place saved at part N" and keeps it. */
        int savedChunk = s.optInt("savedChunk", -1);
        if (hasDoc && savedChunk >= 0) {
            line.append(" · place saved at part ").append(savedChunk + 1);
        }
        /* Seat B delta 4 (Evie's steal): time remaining stands
           on the status line beside the part count — but only
           the label the host could compute truthfully; when it
           cannot, nothing is appended (no guessed number). */
        if (hasDoc && timeRemaining != null) {
            line.append(" · ").append(timeRemaining);
        }
        if ("listening".equals(voice)) line.append(" · listening\u2026");
        statusLine.setText(line.toString());

        lastCanContinue = canContinue;
        if ("playing".equals(playback)) btnPlayPause.setText("\u23F8 Pause");
        else if ("paused".equals(playback)) btnPlayPause.setText("\u25B6 Resume");
        else if (!hasDoc && !canContinue) btnPlayPause.setText("Choose a document");
        else btnPlayPause.setText("\u25B6 Play");
        /* The empty state's primary action is live by design
           (it navigates); every other state keeps the truthful
           rule: Play needs a document or a saved place. */
        btnPlayPause.setEnabled(hasDoc || canContinue || chooseDocumentAction != null);

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
        /* The Marks button needs the open document; its acts
           live in the sheet. Favorite state no longer renders
           here — it is an act and a fact inside the sheet and
           in the Library row's star. */
        btnMarks.setEnabled(hasDoc);
    }
}

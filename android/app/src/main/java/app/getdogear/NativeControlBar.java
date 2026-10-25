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

    private final TextView titleLine;
    private final TextView statusLine;
    private final TextView talkLine;
    private final LinearLayout continueRow;
    private final Button btnPlayPause;
    private final Button btnStop;
    private final Button btnTalk;
    private final Button btnContinue;
    private final Button btnMarks;

    /* Build H (D-8): the Talk episode's text mirror — the
       piece the Announcer is speaking right now, and, for a
       failure, the line that stays standing after it has
       spoken (the reason remains readable until the next
       episode or another document). Fed by the host from the
       Announcer's piece sink; rendered under the state texts
       (gate/listening/processing), which outrank it. */
    private String spokenPiece;
    private String stickyFailure;
    private String stickyDocId;
    private boolean announcementLive;

    private String playback = "none";
    private String voice = "idle";
    private boolean hasDoc = false;
    private boolean lastCanContinue = false;
    /* Redesign: the empty state's primary action ("Choose a
       document") navigates to the Library; the host wires it. */
    private Runnable chooseDocumentAction;
    /* Build E: the Marks button opens the host's Marks sheet. */
    private Runnable marksAction;
    /* Build F (U-1): the transport press path, wired by the
       host. The bar no longer decides pause-vs-resume from its
       own cached rendering — a stale cache made it call a verb
       that no-opped silently and the press vanished. The host
       halts the feeder synchronously and lets PlayerCore's
       toggle decide from the machine's current truth. */
    private Runnable transportAction;
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

    public void setTransportAction(Runnable action) {
        transportAction = action;
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
        /* Depth (Build F, Q-4): the Listen deck FLOATS, in the
           same elevation language as the Now Listening strip —
           a rounded dark card over the ground (the host gives
           it margins), not a full-bleed flat slab. One element,
           one treatment, everywhere it stands. */
        android.graphics.drawable.GradientDrawable deckBg =
                new android.graphics.drawable.GradientDrawable();
        deckBg.setColor(0xFF0B1B30);
        deckBg.setCornerRadius(dp(16));
        setBackground(deckBg);
        setElevation(dp(10));
        int pad = dp(10);
        setPadding(pad, dp(6), pad, dp(8));

        /* 1.1.0 finish pass (presentation only — no behavior
           change anywhere in this file's edits): a hairline
           separates the bar from the page above it. */
        View divider = new View(activity);
        divider.setBackgroundColor(0xFF16324F);
        addView(divider, new LayoutParams(LayoutParams.MATCH_PARENT, dp(1)));

        /* Build H (D-13): the title has its OWN line now. On
           Build G the title was the first segment of the status
           line, and on an untitled document the ~90-character
           excerpt the app uses as a title consumed the whole
           two-line budget — the status facts, time-remaining
           first among them, were ellipsized off and never
           reached the glass at all (QUALITY C7). The title
           truncates to one line with an ellipsis; the status
           line below carries facts only, and always in full. */
        titleLine = new TextView(activity);
        titleLine.setTextColor(0xFFFFFFFF);
        titleLine.setTextSize(14f);
        titleLine.setTypeface(null, android.graphics.Typeface.BOLD);
        titleLine.setSingleLine(true);
        titleLine.setEllipsize(android.text.TextUtils.TruncateAt.END);
        titleLine.setText("DogEar");
        addView(titleLine, new LayoutParams(LayoutParams.MATCH_PARENT,
                LayoutParams.WRAP_CONTENT));

        statusLine = new TextView(activity);
        statusLine.setTextColor(0xFFBFD9F7);
        statusLine.setTextSize(13f);
        /* Build F (QUALITY seat, baseline list #4): the status
           line was single-line, and with title + state + part +
           saved place + time remaining all present, the LAST
           segment — the promised time remaining — was the one
           ellipsized away. The line may now take two lines; the
           facts are never sacrificed to the fit. */
        statusLine.setSingleLine(false);
        statusLine.setMaxLines(2);
        statusLine.setEllipsize(android.text.TextUtils.TruncateAt.END);
        statusLine.setText("Open a document to listen");
        LayoutParams slp = new LayoutParams(LayoutParams.MATCH_PARENT,
                LayoutParams.WRAP_CONTENT);
        slp.topMargin = dp(2);
        statusLine.setMinHeight(dp(24));
        addView(statusLine, slp);

        /* Build H (D-8): Talk's visible state line. What Talk
           is doing — checking, listening, working — and what
           it is SAYING (the Announcer's current piece, mirrored
           by the host) stand here in text for the episode's
           whole window; a failure's reason stays standing
           afterwards. Absent when Talk is idle and silent:
           no placeholder, no dead text. */
        talkLine = new TextView(activity);
        talkLine.setTextColor(0xFFFFE1B0);
        talkLine.setTextSize(13f);
        talkLine.setSingleLine(false);
        talkLine.setMaxLines(3);
        talkLine.setEllipsize(android.text.TextUtils.TruncateAt.END);
        talkLine.setVisibility(View.GONE);
        LayoutParams tlp = new LayoutParams(LayoutParams.MATCH_PARENT,
                LayoutParams.WRAP_CONTENT);
        tlp.topMargin = dp(2);
        addView(talkLine, tlp);

        LinearLayout transport = row();
        btnPlayPause = button("\u25B6 Play");
        btnStop = button("\u23F9 Stop");
        btnTalk = button("\uD83C\uDFA4 Talk");
        /* One obvious primary action (placement law 2): Play
           carries the accent; Talk, the voice primary, carries
           weight. Everything else stays quiet. */
        btnPlayPause.setBackgroundTintList(ColorStateList.valueOf(0xFF175C4C));
        btnPlayPause.setTypeface(null, android.graphics.Typeface.BOLD);
        btnTalk.setTypeface(null, android.graphics.Typeface.BOLD);
        transport.addView(btnPlayPause);
        transport.addView(btnStop);
        transport.addView(btnTalk);
        addView(transport);

        /* Build H (D-7): Continue has its own full-width row,
           and it EXISTS only when it means something the
           transport toggle does not — a saved place that
           differs from where the reading stands — labelled
           with its destination. On Build G it stood beside
           Resume in every state with the same glyph and
           nothing to tell them apart (both seats stumbled on
           it). Its glyph remains U+25B6 (Build F, Q-1). */
        continueRow = row();
        btnContinue = button("\u25B6 Continue");
        continueRow.addView(btnContinue);
        continueRow.setVisibility(View.GONE);
        addView(continueRow);

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
                /* Build F (U-1): the press goes to the host's
                   transport path — the feeder halts on the press
                   itself and the core's toggle decides from
                   current truth. The cached-verb path below is
                   kept only for a bar with no host wired. */
                if (transportAction != null) {
                    transportAction.run();
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

    /** The Announcer's piece sink, wired by the host (Build
     *  H, D-8): as each piece is handed to the voice, the deck
     *  shows it in text; a failure's line becomes the standing
     *  reason when its job ends. */
    public void onSpokenPiece(String tag, String text, String docId) {
        announcementLive = true;
        spokenPiece = text;
        if ("failure".equals(tag)) {
            stickyFailure = text;
            stickyDocId = docId;
        }
        render(core.snapshot());
    }

    public void onSpokenJobFinished(String tag) {
        announcementLive = false;
        spokenPiece = null;
        render(core.snapshot());
    }

    public void render(JSONObject s) {
        playback = s.optString("playback", "none");
        voice = s.optString("voice", "idle");
        hasDoc = !s.isNull("docId");
        String docId = s.isNull("docId") ? null : s.optString("docId", null);
        String title = s.optString("title", "");
        int chunk = s.optInt("chunk", -1);
        int chunks = s.optInt("chunks", 0);
        boolean favorite = s.optBoolean("favorite", false);
        boolean canContinue = s.optBoolean("canContinue", false);
        String talkGate = s.optString("talkGate", "idle");

        /* Build H (D-13): the title stands on its own line and
           truncates there; the status line carries facts only. */
        if (hasDoc) {
            titleLine.setText(title.isEmpty() ? "Your document" : title);
        } else {
            titleLine.setText("DogEar");
        }

        StringBuilder line = new StringBuilder();
        if (!hasDoc && canContinue) line.append("A saved place is waiting");
        else if (!hasDoc) line.append("No document open — choose one from the Library");
        if ("playing".equals(playback)) {
            if (line.length() > 0) line.append(" · ");
            line.append("reading aloud");
        } else if ("paused".equals(playback)) {
            if (line.length() > 0) line.append(" · ");
            line.append("paused");
        } else if ("stopped".equals(playback)) {
            if (line.length() > 0) line.append(" · ");
            line.append("stopped");
        }
        if (hasDoc && chunks > 0 && chunk >= 0) {
            line.append(" · part ").append(chunk + 1).append(" of ").append(chunks);
        }
        /* Build H (D-7): the two places have different words,
           because they are different things. The DELIBERATE
           mark is "Saved place" (the sheet's row, the Continue
           label and this line all say it); the AUTOMATIC live
           position is "your place". Through Build G this line
           said "place saved at part N" for the automatic
           position too — while the Marks sheet truthfully
           said "No marks yet" — and the USER seat had to work
           out unaided that both were true in their own way.
           W-2's standing confirmation is kept: when a pin
           exists, this line names it, at the point of action. */
        int pinChunk = s.optInt("pinChunk", -1);
        int savedChunk = s.optInt("savedChunk", -1);
        if (hasDoc && pinChunk >= 0) {
            line.append(" · Saved place at part ").append(pinChunk + 1);
        } else if (hasDoc && savedChunk >= 0) {
            line.append(" · your place at part ").append(savedChunk + 1);
        }
        /* Seat B delta 4 (Evie's steal): time remaining stands
           on the status line beside the part count — but only
           the label the host could compute truthfully; when it
           cannot, nothing is appended (no guessed number). */
        if (hasDoc && timeRemaining != null) {
            line.append(" · ").append(timeRemaining);
        }
        statusLine.setText(line.toString());

        /* Build H (D-8): Talk's text state. The machine's own
           states outrank the mirrored speech; a NEW episode
           (gate checking, capture live) retires the previous
           episode's standing reason, as does another document. */
        if ("checking".equals(talkGate) || "listening".equals(voice)) {
            stickyFailure = null;
            stickyDocId = null;
        }
        if (stickyDocId != null && docId != null
                && !stickyDocId.equals(docId)) {
            stickyFailure = null;
            stickyDocId = null;
        }
        String talkText = null;
        if ("checking".equals(talkGate)) {
            talkText = "\uD83C\uDFA4 Talk — checking the voice model "
                    + "on this device\u2026";
        } else if ("listening".equals(voice)) {
            talkText = "\uD83C\uDFA4 Listening — speak now; tap Done "
                    + "when you finish.";
        } else if ("processing".equals(voice)) {
            talkText = "\uD83C\uDFA4 Working on what you said\u2026";
        } else if (announcementLive && spokenPiece != null) {
            talkText = spokenPiece;
        } else if (stickyFailure != null) {
            talkText = "\uD83C\uDFA4 " + stickyFailure;
        }
        if (talkText == null) {
            talkLine.setVisibility(View.GONE);
        } else {
            talkLine.setText(talkText);
            talkLine.setVisibility(View.VISIBLE);
        }

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

        /* Build H (D-7): one play verb per state. The toggle
           above is the state's one verb (Play / Pause /
           Resume); Continue exists ONLY when a saved place
           stands somewhere the reading is not — anywhere else
           it would be a second, indistinguishable "keep
           going" (the seats' finding) — and it is labelled
           with its destination, so its one difference from
           Resume is on its face. */
        boolean showContinue = hasDoc && pinChunk >= 0 && pinChunk != chunk;
        continueRow.setVisibility(showContinue ? View.VISIBLE : View.GONE);
        if (showContinue) {
            btnContinue.setText("\u25B6 Continue from saved place \u00B7 part "
                    + (pinChunk + 1));
            btnContinue.setEnabled(true);
        }
        /* The Marks button needs the open document; its acts
           live in the sheet. Favorite state no longer renders
           here — it is an act and a fact inside the sheet and
           in the Library row's star. */
        btnMarks.setEnabled(hasDoc);
    }
}

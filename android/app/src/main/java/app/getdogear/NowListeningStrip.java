package app.getdogear;

import android.app.Activity;
import android.content.res.ColorStateList;
import android.graphics.drawable.GradientDrawable;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * The NOW LISTENING strip (Build E — Seat B, "the player is a
 * place", owner-endorsed 2026-10-24 23:37 MDT; the Audible
 * mini-player pattern, DogEar's job). A standing card that
 * floats above the navigation whenever a document is open OR
 * a saved place exists: title · part x of y · time remaining ·
 * one big Play/Pause · Talk. Resume is a standing action,
 * reachable in one tap from every area — never a screen you
 * must navigate back to.
 *
 * Presence law (Phase 0): when nothing is open and no place
 * exists, the strip is ABSENT — no placeholder, no disabled
 * ghost, nothing takes its place. The host computes presence
 * and the display facts (it owns the stores); the strip keeps
 * no state of its own and renders what it is given.
 *
 * Depth (owner doctrine 2026-10-24 23:38): the strip is a
 * card ON a ground — rounded, elevated, margined so the
 * ground shows around it. It reads as an object floating over
 * the app, not a strip of the chrome.
 */
public final class NowListeningStrip extends LinearLayout {

    /** The display facts, computed by the host from the core
     *  snapshot and the stores. remaining may be null — time
     *  remaining is shown only when it can be computed
     *  truthfully, and is simply absent otherwise. */
    public static final class Info {
        public String title = "";
        public int part;          // 1-based part to display
        public int parts;         // total parts, 0 = unknown
        public String remaining;  // e.g. "about 25 min left", or null
        public boolean pinned;    // the place shown is a saved pin
        public boolean sessionOpen;
        public String playback = "none";
        public String voice = "idle";
    }

    private final TextView titleLine;
    private final TextView metaLine;
    private final Button btnPlayPause;
    private final Button btnTalk;

    private Runnable bodyAction;
    private Runnable playPauseAction;
    private Runnable talkAction;

    public NowListeningStrip(Activity activity) {
        super(activity);
        setOrientation(HORIZONTAL);
        setGravity(android.view.Gravity.CENTER_VERTICAL);

        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFF10243E);
        bg.setCornerRadius(dp(16));
        setBackground(bg);
        setElevation(dp(10));
        setPadding(dp(14), dp(10), dp(10), dp(10));
        LayoutParams lp = new LayoutParams(
                LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT);
        lp.setMargins(dp(10), dp(8), dp(10), dp(8));
        setLayoutParams(lp);

        LinearLayout texts = new LinearLayout(activity);
        texts.setOrientation(VERTICAL);
        titleLine = new TextView(activity);
        titleLine.setTextColor(0xFFFFFFFF);
        titleLine.setTextSize(15f);
        titleLine.setTypeface(null, android.graphics.Typeface.BOLD);
        titleLine.setSingleLine(true);
        titleLine.setEllipsize(android.text.TextUtils.TruncateAt.END);
        texts.addView(titleLine);
        metaLine = new TextView(activity);
        metaLine.setTextColor(0xFFBFD9F7);
        metaLine.setTextSize(12.5f);
        metaLine.setSingleLine(true);
        metaLine.setEllipsize(android.text.TextUtils.TruncateAt.END);
        texts.addView(metaLine);
        texts.setOnClickListener(v -> { if (bodyAction != null) bodyAction.run(); });
        addView(texts, new LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f));
        setOnClickListener(v -> { if (bodyAction != null) bodyAction.run(); });

        btnPlayPause = new Button(activity);
        btnPlayPause.setTextSize(15f);
        btnPlayPause.setAllCaps(false);
        btnPlayPause.setTypeface(null, android.graphics.Typeface.BOLD);
        btnPlayPause.setTextColor(0xFFFFFFFF);
        btnPlayPause.setBackgroundTintList(ColorStateList.valueOf(0xFF175C4C));
        LayoutParams plp = new LayoutParams(dp(92), dp(56));
        plp.setMargins(dp(8), 0, 0, 0);
        btnPlayPause.setLayoutParams(plp);
        btnPlayPause.setOnClickListener(v -> {
            if (playPauseAction != null) playPauseAction.run();
        });
        addView(btnPlayPause);

        btnTalk = new Button(activity);
        btnTalk.setTextSize(14f);
        btnTalk.setAllCaps(false);
        btnTalk.setTypeface(null, android.graphics.Typeface.BOLD);
        btnTalk.setTextColor(new ColorStateList(
                new int[][] {
                    new int[] { android.R.attr.state_enabled },
                    new int[] {},
                },
                new int[] { 0xFFEAF3FE, 0xFF7E93AC }));
        btnTalk.setBackgroundTintList(ColorStateList.valueOf(0xFF16324F));
        LayoutParams tlp = new LayoutParams(dp(76), dp(56));
        tlp.setMargins(dp(6), 0, 0, 0);
        btnTalk.setLayoutParams(tlp);
        btnTalk.setOnClickListener(v -> {
            if (talkAction != null) talkAction.run();
        });
        addView(btnTalk);
    }

    public void setBodyAction(Runnable r) { bodyAction = r; }
    public void setPlayPauseAction(Runnable r) { playPauseAction = r; }
    public void setTalkAction(Runnable r) { talkAction = r; }

    public void render(Info info) {
        titleLine.setText(info.title.isEmpty() ? "Your document" : info.title);
        StringBuilder meta = new StringBuilder();
        if (info.parts > 0 && info.part > 0) {
            meta.append("Part ").append(info.part)
                    .append(" of ").append(info.parts);
        }
        /* Build H (D-7): the place-only state's two places
           carry their two words here too — the deliberate pin
           is the "Saved place"; the automatic live position is
           "your place". Through Build G the strip said "saved
           place" for the pin only and nothing at all for the
           position, while the deck said "place saved" for
           both; the vocabulary now agrees on every surface. */
        if (!info.sessionOpen) {
            if (meta.length() > 0) meta.append(" · ");
            meta.append(info.pinned ? "Saved place" : "your place");
        }
        if ("playing".equals(info.playback)) {
            if (meta.length() > 0) meta.append(" · ");
            meta.append("reading aloud");
        } else if ("paused".equals(info.playback)) {
            if (meta.length() > 0) meta.append(" · ");
            meta.append("paused");
        }
        if (info.remaining != null) {
            if (meta.length() > 0) meta.append(" · ");
            meta.append(info.remaining);
        }
        metaLine.setText(meta.toString());

        if ("playing".equals(info.playback)) {
            btnPlayPause.setText("\u23F8 Pause");
        } else if ("paused".equals(info.playback)) {
            btnPlayPause.setText("\u25B6 Resume");
        } else if (info.sessionOpen) {
            btnPlayPause.setText("\u25B6 Play");
        } else {
            /* No session: the button IS Continue — it resumes
               the place the strip is showing. */
            btnPlayPause.setText("\u25B6 Continue");
        }

        if ("listening".equals(info.voice)) {
            btnTalk.setText("\u23F9 Done");
            btnTalk.setEnabled(true);
        } else if ("processing".equals(info.voice)) {
            btnTalk.setText("Working\u2026");
            btnTalk.setEnabled(false);
        } else {
            btnTalk.setText("\uD83C\uDFA4 Talk");
            btnTalk.setEnabled(true);
        }
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}

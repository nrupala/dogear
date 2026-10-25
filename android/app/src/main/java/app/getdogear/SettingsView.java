package app.getdogear;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Typeface;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * SETTINGS / ADMIN — the separate door (Phase 1 area law):
 * everything that configures or administers lives here and ONLY
 * here — the voice-model shelf, the reading voice, the plan &
 * licence truth, storage, and Help & About. No primary action:
 * no single move outranks the others, and nothing here is needed
 * to listen.
 *
 * Truth discipline: the shelf's per-model state comes from the
 * engine itself (voicepack status), the licence state from the
 * native Licence store (verified through the shipped verifier),
 * and the plan numbers are the settled ones — 600 free minutes a
 * month, US$24.99 one-time. Where this build cannot do a thing
 * (store purchase), the surface says so instead of pretending.
 */
public final class SettingsView extends ScrollView {

    private static final class Tier {
        final String id, label;
        final long bytes;
        final boolean runnable;

        Tier(String id, String label, long bytes, boolean runnable) {
            this.id = id;
            this.label = label;
            this.bytes = bytes;
            this.runnable = runnable;
        }
    }

    /* The shelf facts (PACK-REGISTRY.json, pack dogear-voice-pack
       v2) — sizes are the registry's own byte counts. The
       runnable line is the engine's memory gate: models over
       100 MB of weights are not offered to the in-app engine. */
    private static final Tier[] TIERS = {
            new Tier("whisper-tiny.en", "Tiny", 44500564L, true),
            new Tier("whisper-base.en", "Base (recommended)", 80556062L, true),
            new Tier("whisper-small.en", "Small", 252753585L, false),
            new Tier("whisper-medium.en", "Medium", 779777327L, false),
            new Tier("whisper-large-v3", "Large", 1564656626L, false),
    };

    private final Shell shell;
    private final LinearLayout body;
    private final Map<String, TextView> tierLines = new HashMap<String, TextView>();
    private final Map<String, Button> tierButtons = new HashMap<String, Button>();
    private final Map<String, String> tierStates = new HashMap<String, String>();
    private TextView licenceState;
    private TextView licenceTitle;
    private TextView storageLine;
    private EditText keyInput;
    private TextView voiceState;
    private int reqSeq = 1000;
    private String selectedModel = "";

    public SettingsView(Context ctx, Shell shell) {
        super(ctx);
        this.shell = shell;
        /* Depth (Build E): Settings sits on the same app
           ground as the Library; its shelf rows stand as
           cards (buildShelf). */
        setBackgroundColor(0xFFE9EFF6);
        body = new LinearLayout(ctx);
        body.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        body.setPadding(pad, pad, pad, pad);
        addView(body);
        buildShelf();
        buildVoice();
        buildLicence();
        buildStorage();
        buildHelp();
    }

    // ----------------------------------------------------------
    // Sections
    // ----------------------------------------------------------

    private void buildShelf() {
        body.addView(sectionTitle("Voice pack \u2014 Talk models"));
        body.addView(bodyText("Two-way voice (Talk) listens on this device "
                + "with a model you choose. Nothing is bundled: the model "
                + "you pick downloads once, under its own licence, and "
                + "then works offline. Base is the recommended start."));
        for (final Tier tier : TIERS) {
            LinearLayout row = new LinearLayout(getContext());
            row.setOrientation(LinearLayout.HORIZONTAL);
            row.setPadding(dp(12), dp(8), dp(8), dp(8));
            /* Depth (Build E): each model on the shelf is a
               card on the ground, like a document in the
               Library — the shelf is a shelf. */
            android.graphics.drawable.GradientDrawable cardBg =
                    new android.graphics.drawable.GradientDrawable();
            cardBg.setColor(0xFFFFFFFF);
            cardBg.setCornerRadius(dp(12));
            row.setBackground(cardBg);
            row.setElevation(dp(3));
            LinearLayout.LayoutParams rlp = new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT,
                    LinearLayout.LayoutParams.WRAP_CONTENT);
            rlp.setMargins(0, 0, 0, dp(8));
            row.setLayoutParams(rlp);
            TextView line = new TextView(getContext());
            line.setTextSize(14);
            line.setTextColor(0xFF10243E);
            row.addView(line, new LinearLayout.LayoutParams(
                    0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
            Button action = new Button(getContext());
            action.setAllCaps(false);
            /* Depth + contrast (Build F, Q-2/Q-4): the shelf's
               state chips carry the shared in-card control
               language (light rounded face, small elevation,
               full-strength dark text) — they read as the
               controls they are, in every state. */
            android.graphics.drawable.GradientDrawable chipBg =
                    new android.graphics.drawable.GradientDrawable();
            chipBg.setColor(0xFFEAF3FE);
            chipBg.setCornerRadius(dp(10));
            action.setBackground(chipBg);
            action.setElevation(dp(2));
            action.setTextColor(0xFF10243E);
            action.setOnClickListener(v -> tierAction(tier));
            row.addView(action);
            body.addView(row);
            tierLines.put(tier.id, line);
            tierButtons.put(tier.id, action);
        }
    }

    private void buildVoice() {
        body.addView(sectionTitle("Reading voice"));
        voiceState = bodyText("");
        body.addView(voiceState);
        Button pick = new Button(getContext());
        pick.setText("Choose a voice");
        pick.setAllCaps(false);
        pick.setOnClickListener(v -> voiceDialog());
        body.addView(pick);
        TextView rateLabel = bodyText("Reading speed");
        body.addView(rateLabel);
        SeekBar rate = new SeekBar(getContext());
        rate.setMax(150); // 0.5x .. 2.0x in 0.01 steps
        rate.setProgress(Math.round((shell.speechRate() - 0.5f) * 100));
        rate.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
            @Override public void onProgressChanged(SeekBar sb, int p, boolean user) {
                if (user) shell.setSpeechRate(0.5f + p / 100f);
            }
            @Override public void onStartTrackingTouch(SeekBar sb) {}
            @Override public void onStopTrackingTouch(SeekBar sb) {}
        });
        body.addView(rate);
    }

    private List<String> voiceNames;
    private String currentVoice = "";

    public void setVoices(List<String> names, String current) {
        voiceNames = names;
        currentVoice = current == null ? "" : current;
        renderVoiceState();
    }

    private void renderVoiceState() {
        if (voiceState == null) return;
        voiceState.setText("Voice: "
                + (currentVoice.isEmpty() ? "device default" : currentVoice)
                + " \u00B7 Speed: "
                + String.format(java.util.Locale.US, "%.2f\u00D7", shell.speechRate()));
    }

    private void voiceDialog() {
        if (voiceNames == null || voiceNames.isEmpty()) {
            note("No voices were found on this device yet \u2014 the "
                    + "speech service may still be starting. Try again "
                    + "in a moment.");
            return;
        }
        final String[] names = voiceNames.toArray(new String[0]);
        new AlertDialog.Builder(getContext())
                .setTitle("Reading voice")
                .setItems(names, (d, which) -> {
                    shell.setSpeechVoice(names[which]);
                    currentVoice = names[which];
                    renderVoiceState();
                })
                .show();
    }

    private void buildLicence() {
        licenceTitle = sectionTitle("Plan & licence");
        body.addView(licenceTitle);
        /* Build F (Q-3): the terms stand here ALWAYS, in
           every licence state. On Build E the price and the
           minutes lived only in the no-key branch of the
           state line — a device holding a saved-but-unverified
           key (the QUALITY seat's) showed neither figure
           anywhere on the surface. */
        body.addView(bodyText("The terms, in plain words: free "
                + "listening is 600 minutes every month. The "
                + "unlock is one payment of US$24.99 \u2014 never "
                + "a subscription \u2014 for unlimited listening "
                + "and two-way voice (Talk)."));
        licenceState = bodyText("");
        body.addView(licenceState);
        keyInput = new EditText(getContext());
        keyInput.setHint("Paste a licence key");
        body.addView(keyInput);
        Button verify = new Button(getContext());
        verify.setText("Save & verify key");
        verify.setAllCaps(false);
        verify.setOnClickListener(v -> {
            String token = keyInput.getText().toString().trim();
            if (token.isEmpty()) return;
            /* Masked display (below) is not a key: never store
               the mask as if it were one. */
            if (token.indexOf('\u2022') >= 0) {
                renderLicenceState("That key is already saved on "
                        + "this device. To use a different key, "
                        + "clear the field and paste the new one.");
                return;
            }
            shell.licence().store(token);
            renderLicenceState("Key saved \u2014 verifying its signature\u2026");
            EngineHost host = shell.engineHost();
            if (host != null) host.verifyLicence(reqSeq++, token);
        });
        body.addView(verify);
        body.addView(bodyText("In this build there is no store purchase "
                + "yet \u2014 buying arrives with the store release. A "
                + "licence key unlocks here, verified on this device."));
    }

    private void buildStorage() {
        body.addView(sectionTitle("Storage"));
        storageLine = bodyText("");
        body.addView(storageLine);
        renderStorage();
        Button clear = new Button(getContext());
        clear.setText("Remove downloaded voice models");
        clear.setAllCaps(false);
        clear.setOnClickListener(v -> {
            EngineHost host = shell.engineHost();
            if (host != null) host.clearPack();
        });
        body.addView(clear);
    }

    private void buildHelp() {
        body.addView(sectionTitle("Help & About"));
        SelfModel.Ctx ctx = new SelfModel.Ctx();
        ctx.unlocked = shell.licence().isUnlocked();
        body.addView(bodyText(SelfModel.answerFor("identity", ctx)));
        body.addView(bodyText(SelfModel.answerFor("controls", ctx)));
        body.addView(bodyText(SelfModel.answerFor("talk", ctx)));
        body.addView(bodyText(SelfModel.answerFor("plan", ctx)));
        body.addView(bodyText(SelfModel.answerFor("limits", ctx)));
        body.addView(bodyText("DogEar is made by 2351485 ALBERTA INC. "
                + "(AIMLDS), Alberta, Canada."));
    }

    // ----------------------------------------------------------
    // Live state
    // ----------------------------------------------------------

    public void refresh() {
        renderLicenceState(null);
        renderVoiceState();
        renderStorage();
        refreshShelf();
    }

    /** Build F (U-5): the Storage count is read LIVE, at
     *  display time, on every refresh. Build E read it once in
     *  the constructor — a view built before any document was
     *  added announced "Documents on this device: 0" forever,
     *  over a Library holding documents. Counts are rendered
     *  from the store at the moment they are shown, never
     *  remembered. */
    private void renderStorage() {
        if (storageLine == null) return;
        int docsCount = shell.documents().list().size();
        storageLine.setText("Documents on this device: " + docsCount
                + ". Documents and marks never leave the device.");
    }

    private void refreshShelf() {
        EngineHost host = shell.engineHost();
        boolean unlocked = shell.licence().isUnlocked();
        for (Tier tier : TIERS) {
            TextView line = tierLines.get(tier.id);
            Button action = tierButtons.get(tier.id);
            if (line == null || action == null) continue;
            String state = tierStates.get(tier.id);
            StringBuilder sb = new StringBuilder();
            sb.append(tier.label).append(" \u00B7 ").append(sizeLabel(tier.bytes));
            if (!tier.runnable) {
                sb.append(" \u00B7 Not offered yet \u2014 it needs more "
                        + "memory than the in-app engine can safely use.");
                action.setText("Held");
                /* Build F (Q-2): ENABLED. A chip shaped as a
                   button answers its tap — with its reason
                   (tierAction). Build E disabled these, so the
                   tap died in silence and the chip read as a
                   broken button. There are no bare disabled
                   states on this surface: the two remaining
                   disabled renderings (Checking…, Downloading…)
                   are live progress, self-resolving and
                   re-queried on every render pass. */
                action.setEnabled(true);
            } else if (!unlocked) {
                sb.append(" \u00B7 Part of the unlock.");
                action.setText("Needs unlock");
                action.setEnabled(true);
            } else if (state == null) {
                sb.append(" \u00B7 Checking\u2026");
                action.setText("\u2026");
                action.setEnabled(false);
                if (host != null) host.status(reqSeq++, tier.id);
            } else if ("downloading".equals(state)) {
                /* Shelf-truth fix (Build D, from the finishing
                   run's observation): a tier in flight used to
                   fall into the else branch below and render as
                   "Not downloaded" on ANY re-render during the
                   download — the shelf's surface truth lagged
                   until the area was left and re-entered. In
                   flight now renders as in flight, and every
                   render pass re-queries the engine's own status
                   so a stale local claim reconciles with the
                   engine's standing instead of waiting for a
                   navigation. */
                sb.append(" \u00B7 Downloading\u2026");
                action.setText("Downloading\u2026");
                action.setEnabled(false);
                if (host != null) host.status(reqSeq++, tier.id);
            } else if ("installed".equals(state)) {
                sb.append(" \u00B7 Installed");
                if (tier.id.equals(selectedModel)) sb.append(" \u00B7 In use");
                action.setText("Remove");
                action.setEnabled(true);
            } else {
                sb.append(" \u00B7 Not downloaded");
                action.setText("Download");
                action.setEnabled(true);
            }
            line.setText(sb.toString());
        }
        if (host != null && unlocked) host.selectedModel(reqSeq++);
    }

    private void tierAction(Tier tier) {
        /* Build F (Q-2): the standing states answer with their
           reason, in place — Held says why it is held; Needs
           unlock states the unlock's terms and takes the user
           to the section that holds them. A chip that looks
           tappable either acts or explains; it never ignores. */
        if (!tier.runnable) {
            note(tier.label + " is held back on purpose: it needs "
                    + "more memory than the in-app engine can "
                    + "safely use, so it is not offered here. "
                    + "Tiny and Base are the models this surface "
                    + "can run.");
            return;
        }
        if (!shell.licence().isUnlocked()) {
            note("Talk models are part of the unlock \u2014 one "
                    + "payment of US$24.99, never a subscription, "
                    + "for unlimited listening and two-way voice. "
                    + "Plan & licence, just below, states the "
                    + "full terms.");
            if (licenceTitle != null) {
                smoothScrollTo(0, Math.max(0,
                        licenceTitle.getTop() - dp(8)));
            }
            return;
        }
        EngineHost host = shell.engineHost();
        if (host == null) return;
        String state = tierStates.get(tier.id);
        if ("installed".equals(state)) {
            host.removeModel(tier.id);
        } else {
            tierStates.put(tier.id, "downloading");
            renderTier(tier, "Downloading\u2026");
            host.download(tier.id);
        }
    }

    private void renderTier(Tier tier, String note) {
        TextView line = tierLines.get(tier.id);
        if (line != null) {
            line.setText(tier.label + " \u00B7 " + sizeLabel(tier.bytes)
                    + " \u00B7 " + note);
        }
    }

    public void onEngineEvent(JSONObject ev) {
        String kind = ev.optString("kind", "");
        if ("status".equals(kind)) {
            JSONObject st = ev.optJSONObject("status");
            if (st != null) {
                String model = st.optString("modelId", "");
                String incoming = st.optString("state", "absent");
                /* D-4 (found exercising Build D; fixed Build E):
                   the engine's truthful MID-FLIGHT answer is
                   "partial"/"absent", and this handler used to
                   overwrite the tier's local "downloading" claim
                   with it — so an in-flight row fell back to
                   "Not downloaded" (with a live Download button)
                   on the next status event, while the download
                   was still running. The local downloading claim
                   now SURVIVES engine "partial"/"absent" events;
                   only the engine saying "installed" (or the
                   download event itself) may end the claim —
                   completion converges exactly as Build D
                   proved, and the mid-flight lie is impossible. */
                String prev = tierStates.get(model);
                if (!("downloading".equals(prev)
                        && !"installed".equals(incoming))) {
                    tierStates.put(model, incoming);
                }
            }
            refreshShelf();
        } else if ("download".equals(kind)) {
            String model = ev.optString("modelId", "");
            if (ev.optBoolean("ok", false)) {
                tierStates.put(model, "installed");
                selectedModel = model;
            } else {
                tierStates.remove(model);
                String reason = ev.optString("reason", "");
                if (!reason.isEmpty()) note(reason);
            }
            refreshShelf();
            /* The shelf's final word on a download is the
               engine's own status, re-queried — not the event
               payload alone (Build D shelf-truth fix). */
            EngineHost host = shell.engineHost();
            if (host != null && !model.isEmpty()) {
                host.status(reqSeq++, model);
            }
        } else if ("remove".equals(kind)) {
            tierStates.remove(ev.optString("modelId", ""));
            refreshShelf();
        } else if ("clear".equals(kind)) {
            tierStates.clear();
            note(ev.optBoolean("ok", false)
                    ? "Downloaded voice models removed."
                    : "The voice models could not be removed right now.");
            refreshShelf();
        } else if ("selected".equals(kind)) {
            selectedModel = ev.optString("modelId", "");
            refreshShelf();
        } else if ("licence".equals(kind)) {
            // The activity records the verdict in the Licence
            // store; this view just re-renders from it — licence
            // state AND the shelf, whose availability turns on it.
            renderLicenceState(ev.optBoolean("ok", false)
                    ? null : ev.optString("reason", ""));
            refreshShelf();
        }
    }

    private void renderLicenceState(String transientNote) {
        if (licenceState == null) return;
        Licence licence = shell.licence();
        StringBuilder sb = new StringBuilder();
        if (licence.isUnlocked()) {
            JSONObject payload = licence.payload();
            sb.append("Unlocked");
            if (payload != null) {
                String holder = payload.optString("holder", "");
                String plan = payload.optString("plan", "");
                if (!holder.isEmpty()) sb.append(" \u00B7 ").append(holder);
                if (!plan.isEmpty()) sb.append(" \u00B7 ").append(plan);
            }
            sb.append(". Listening is unlimited and two-way voice is yours.");
        } else if (licence.token() != null) {
            sb.append("A licence key is saved but not verified yet. ");
            sb.append(transientNote != null ? transientNote
                    : "It unlocks nothing until its signature checks out.");
        } else {
            sb.append("Free plan: 600 minutes of listening every month. "
                    + "The unlock is one payment of US$24.99 \u2014 never a "
                    + "subscription \u2014 for unlimited listening and "
                    + "two-way voice.");
            if (transientNote != null) sb.append(" ").append(transientNote);
        }
        licenceState.setText(sb.toString());
        /* Masking (Build D, from the finishing run's
           observation): once a key is VERIFIED, the field no
           longer shows it in clear — the verified state above
           (Unlocked · holder · plan) is the visible truth, and
           the field keeps only a short suffix so the owner can
           tell WHICH key is saved. The stored token itself is
           untouched; only the display is masked. An unverified
           key is never masked — the owner may still be working
           with it. */
        if (licence.isUnlocked() && keyInput != null) {
            String shown = keyInput.getText().toString();
            if (!shown.isEmpty() && shown.indexOf('\u2022') < 0) {
                String suffix = shown.length() > 4
                        ? shown.substring(shown.length() - 4) : shown;
                keyInput.setText("\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"
                        + suffix);
            }
        }
    }

    private void note(String msg) {
        new AlertDialog.Builder(getContext())
                .setMessage(msg)
                .setPositiveButton("OK", null)
                .show();
    }

    private TextView sectionTitle(String s) {
        TextView tv = new TextView(getContext());
        tv.setText(s);
        tv.setTextSize(17);
        tv.setTypeface(null, Typeface.BOLD);
        tv.setTextColor(0xFF10243E);
        tv.setPadding(0, dp(18), 0, dp(6));
        return tv;
    }

    private TextView bodyText(String s) {
        TextView tv = new TextView(getContext());
        tv.setText(s);
        tv.setTextSize(14);
        tv.setTextColor(0xFF33475B);
        tv.setLineSpacing(0, 1.3f);
        tv.setPadding(0, dp(2), 0, dp(6));
        return tv;
    }

    private static String sizeLabel(long bytes) {
        double mb = bytes / 1_000_000.0;
        return mb >= 1000
                ? String.format(java.util.Locale.US, "%.2f GB", mb / 1000.0)
                : String.format(java.util.Locale.US, "%.0f MB", mb);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}

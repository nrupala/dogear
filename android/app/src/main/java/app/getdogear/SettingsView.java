package app.getdogear;

import android.app.AlertDialog;
import android.content.Context;
import android.graphics.Typeface;
import android.speech.tts.Voice;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
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

    /** A shelf card's moving parts (Build I, Q-H2): the head
     *  line (model · size) and the state line beneath it are
     *  SEPARATE views. Through Build H2 one text view carried
     *  both, laid out by weight beside the chip button — a
     *  weighted child in a horizontal row has its wrapped
     *  height measured against the row the button sets, and
     *  the longest texts (the held models' reasons) overflowed
     *  the card and were clipped mid-sentence at its bottom
     *  edge (the QUALITY seat: the full reason existed only in
     *  the tap dialog). The state now stands on its own
     *  full-width line under the head, and the card takes its
     *  natural height: every clause renders whole. */
    private static final class TierRow {
        TextView head;
        TextView state;
        Button action;
    }

    private final Shell shell;
    private final LinearLayout body;
    private final Map<String, TierRow> tierRows = new HashMap<String, TierRow>();
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
            /* Build I (Q-H2): the card is a vertical stack —
               a head row (model · size, with the state chip)
               over the state line at full width (see TierRow:
               a weighted text beside the chip had its wrapped
               height clipped by the row; a full-width line
               under it cannot be). */
            LinearLayout row = new LinearLayout(getContext());
            row.setOrientation(LinearLayout.VERTICAL);
            row.setPadding(dp(12), dp(8), dp(12), dp(10));
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
            LinearLayout headRow = new LinearLayout(getContext());
            headRow.setOrientation(LinearLayout.HORIZONTAL);
            headRow.setGravity(android.view.Gravity.CENTER_VERTICAL);
            TextView head = new TextView(getContext());
            head.setTextSize(14);
            head.setTextColor(0xFF10243E);
            head.setTypeface(null, Typeface.BOLD);
            headRow.addView(head, new LinearLayout.LayoutParams(
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
            headRow.addView(action);
            row.addView(headRow);
            TextView state = new TextView(getContext());
            state.setTextSize(13.5f);
            state.setTextColor(0xFF33475B);
            state.setPadding(0, dp(3), 0, 0);
            row.addView(state);
            body.addView(row);
            TierRow tr = new TierRow();
            tr.head = head;
            tr.state = state;
            tr.action = action;
            tierRows.put(tier.id, tr);
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

    /* Build H (D-14): a voice's PRESENTATION is separate from
       its identity. The identity is the engine's raw name —
       "en-us-x-sfg-local" — and it is what persists and what
       the speech service is told. But through Build G the raw
       code WAS the label: the chooser listed engine codes and
       the Settings line read "Voice: en-US-language", which
       tells a person nothing (QUALITY C8). A voice now
       presents as its language in words, on-device or online,
       and its distinguishing code ("SFG") — "English (United
       States) · on device · SFG". (Build I amends D-14's last
       clause: the raw name no longer stands as the chooser
       row's second line at all — the seats read it as noise
       (H-U2). It lives behind the row's Details affordance;
       the only second line a row may carry now is the online
       caution. See voiceDialog.) */
    /** The online-voice caution, word for word wherever an
     *  online voice is offered (Build I, Q-H5): the picker
     *  row, the Details dialog, the current-voice line. One
     *  constant, so the surfaces can never drift apart. */
    static final String ONLINE_CAUTION =
            "Online voice \u2014 reading is sent over the internet "
            + "for this voice";

    /** A voice is ONLINE when its engine name carries the
     *  -network marker (its -local twins are the on-device
     *  ones); the marker is the engine's own declaration. */
    static boolean isOnlineVoiceName(String name) {
        return name != null && name.contains("-network");
    }

    static final class VoiceInfo {
        final String name;    // raw engine name (the identity)
        final String label;   // human-readable (the presentation)
        final boolean online; // the engine's -network marker

        VoiceInfo(String name, String label) {
            this.name = name;
            this.label = label;
            this.online = isOnlineVoiceName(name);
        }
    }

    static VoiceInfo voiceInfo(Voice v) {
        String name = v.getName();
        String language = null;
        try {
            java.util.Locale loc = v.getLocale();
            if (loc != null) language = loc.getDisplayName(java.util.Locale.ENGLISH);
        } catch (Exception ignored) {}
        return new VoiceInfo(name, voiceLabel(name, language));
    }

    /** The label, composed from whatever is known: the
     *  locale's display name when a Voice object provided it,
     *  else the name's own leading locale segments. */
    static String voiceLabel(String rawName, String languageDisplay) {
        if (rawName == null || rawName.isEmpty()) return "device default";
        String lang = languageDisplay;
        if (lang == null || lang.isEmpty()) {
            java.util.regex.Matcher m = java.util.regex.Pattern
                    .compile("^([a-zA-Z]{2,3})[-_]([a-zA-Z]{2})")
                    .matcher(rawName);
            if (m.find()) {
                try {
                    lang = new java.util.Locale(m.group(1), m.group(2))
                            .getDisplayName(java.util.Locale.ENGLISH);
                } catch (Exception ignored) {}
            }
        }
        StringBuilder sb = new StringBuilder();
        sb.append(lang != null && !lang.isEmpty() ? lang : rawName);
        if (rawName.contains("-network")) sb.append(" \u00B7 online");
        else if (rawName.contains("-local")) sb.append(" \u00B7 on device");
        java.util.regex.Matcher code = java.util.regex.Pattern
                .compile("-x-([a-zA-Z0-9]+)").matcher(rawName);
        if (code.find()) {
            sb.append(" \u00B7 ").append(code.group(1).toUpperCase(java.util.Locale.US));
        }
        return sb.toString();
    }

    private List<VoiceInfo> voiceInfos;
    private String currentVoice = "";

    public void setVoices(List<VoiceInfo> infos, String current) {
        voiceInfos = infos;
        currentVoice = current == null ? "" : current;
        renderVoiceState();
    }

    private String labelForCurrentVoice() {
        if (currentVoice.isEmpty()) return "device default";
        if (voiceInfos != null) {
            for (VoiceInfo info : voiceInfos) {
                if (info.name.equals(currentVoice)) return info.label;
            }
        }
        return voiceLabel(currentVoice, null);
    }

    private void renderVoiceState() {
        if (voiceState == null) return;
        String text = "Voice: " + labelForCurrentVoice()
                + " \u00B7 Speed: "
                + String.format(java.util.Locale.US, "%.2f\u00D7",
                        shell.speechRate());
        /* Build I (Q-H5): when the CURRENT voice is an online
           one, the caution stands on this surface too \u2014 the
           page's standing "nothing leaves the device" lines
           must never read as covering a voice that sends
           reading over the internet to be spoken. */
        if (isOnlineVoiceName(currentVoice)) {
            text += " " + ONLINE_CAUTION + ".";
        }
        voiceState.setText(text);
    }

    /* Build I (H-U2 + Q-H5): the picker is rebuilt around
       one rule — ROWS CARRY HUMAN NAMES ONLY. Through
       Build H2 each row's second line was the raw engine
       code ("ar-xa-x-arc-local"), and the list opened at
       Albanian with a hundred rows of them: the human first
       line read fine (the USER seat said so) but the code
       line was noise a listener should never have to parse.
       The code now lives behind a per-row Details affordance
       (its own dialog: engine name + the on-device/online
       fact in words). ONLINE voices (their engine name
       carries -network) carry the plain caution ON THE ROW,
       in place of any code — the only second line a row may
       have — so the nothing-leaves-the-device claim never
       stands unqualified beside them. A name filter stands
       over the list: type, and the rows narrow to matches. */
    /* Build I (H-U2 + Q-H5): the picker is rebuilt around
       one rule \u2014 ROWS CARRY HUMAN NAMES ONLY. Through
       Build H2 each row's second line was the raw engine
       code ("ar-xa-x-arc-local"), and the list opened at
       Albanian with a hundred rows of them: the human first
       line read fine (the USER seat said so) but the code
       line was noise a listener should never have to parse.
       The code now lives behind a per-row Details affordance
       (its own dialog: the engine name + the on-device/online
       fact in words). ONLINE voices (their engine name
       carries -network) carry the plain caution ON THE ROW,
       in place of any code \u2014 the only second line a row may
       have \u2014 so the nothing-leaves-the-device claim never
       stands unqualified beside them. A name filter stands
       over the list: type, and the rows narrow to matches. */
    private void voiceDialog() {
        if (voiceInfos == null || voiceInfos.isEmpty()) {
            note("No voices were found on this device yet \u2014 the "
                    + "speech service may still be starting. Try again "
                    + "in a moment.");
            return;
        }
        LinearLayout box = new LinearLayout(getContext());
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(16), dp(8), dp(16), 0);
        final EditText search = new EditText(getContext());
        search.setHint("Type to filter by name");
        search.setSingleLine(true);
        box.addView(search);
        final TextView noMatch = new TextView(getContext());
        noMatch.setTextSize(13.5f);
        noMatch.setTextColor(0xFF8A4B00);
        noMatch.setPadding(0, dp(8), 0, 0);
        noMatch.setVisibility(View.GONE);
        box.addView(noMatch);
        ListView list = new ListView(getContext());
        list.setLayoutParams(new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, dp(320)));
        box.addView(list);
        final java.util.List<VoiceInfo> shown =
                new java.util.ArrayList<VoiceInfo>(voiceInfos);
        final AlertDialog[] holder = new AlertDialog[1];
        final BaseAdapter adapter = new BaseAdapter() {
            @Override public int getCount() { return shown.size(); }
            @Override public Object getItem(int i) { return shown.get(i); }
            @Override public long getItemId(int i) { return i; }
            @Override public View getView(int i, View convert,
                                          ViewGroup parent) {
                LinearLayout row;
                TextView primary, caution, details;
                if (convert instanceof LinearLayout
                        && convert.getTag() instanceof Object[]) {
                    row = (LinearLayout) convert;
                    Object[] tag = (Object[]) row.getTag();
                    primary = (TextView) tag[0];
                    caution = (TextView) tag[1];
                    details = (TextView) tag[2];
                } else {
                    row = new LinearLayout(getContext());
                    row.setOrientation(LinearLayout.HORIZONTAL);
                    row.setGravity(android.view.Gravity.CENTER_VERTICAL);
                    row.setPadding(dp(20), dp(10), dp(8), dp(10));
                    LinearLayout texts = new LinearLayout(getContext());
                    texts.setOrientation(LinearLayout.VERTICAL);
                    primary = new TextView(getContext());
                    primary.setTextSize(15);
                    primary.setTextColor(0xFF10243E);
                    texts.addView(primary);
                    caution = new TextView(getContext());
                    caution.setTextSize(12.5f);
                    caution.setTextColor(0xFF8A4B00);
                    texts.addView(caution);
                    row.addView(texts, new LinearLayout.LayoutParams(
                            0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
                    details = new TextView(getContext());
                    details.setText("Details");
                    details.setTextSize(13.5f);
                    details.setTextColor(0xFF175C4C);
                    details.setPadding(dp(12), dp(10), dp(12), dp(10));
                    row.addView(details);
                    row.setTag(new Object[]{primary, caution, details});
                }
                final VoiceInfo info = shown.get(i);
                primary.setText(info.label + (info.name.equals(currentVoice)
                        ? " \u00B7 in use" : ""));
                if (info.online) {
                    caution.setText(ONLINE_CAUTION);
                    caution.setVisibility(View.VISIBLE);
                } else {
                    caution.setVisibility(View.GONE);
                }
                details.setOnClickListener(
                        v -> voiceDetailsDialog(info));
                row.setOnClickListener(v -> {
                    shell.setSpeechVoice(info.name);
                    currentVoice = info.name;
                    renderVoiceState();
                    if (holder[0] != null) holder[0].dismiss();
                });
                return row;
            }
        };
        list.setAdapter(adapter);
        search.addTextChangedListener(new android.text.TextWatcher() {
            @Override public void beforeTextChanged(
                    CharSequence s, int a, int b, int c) {}
            @Override public void onTextChanged(
                    CharSequence s, int a, int b, int c) {}
            @Override public void afterTextChanged(android.text.Editable s) {
                String q = s == null ? "" : s.toString()
                        .trim().toLowerCase(java.util.Locale.US);
                shown.clear();
                for (VoiceInfo info : voiceInfos) {
                    if (q.isEmpty() || info.label
                            .toLowerCase(java.util.Locale.US).contains(q)) {
                        shown.add(info);
                    }
                }
                adapter.notifyDataSetChanged();
                if (shown.isEmpty()) {
                    noMatch.setText("No voice matches \u201C" + s
                            + "\u201D \u2014 clear the filter to see "
                            + "every voice.");
                    noMatch.setVisibility(View.VISIBLE);
                } else {
                    noMatch.setVisibility(View.GONE);
                }
            }
        });
        holder[0] = new AlertDialog.Builder(getContext())
                .setTitle("Choose a voice")
                .setView(box)
                .setNegativeButton("Cancel", null)
                .create();
        holder[0].show();
    }

    /* The Details affordance's dialog: where the engine code
       lives now, together with the network fact in words \u2014
       reached BY CHOICE, never printed on the row. */
    private void voiceDetailsDialog(VoiceInfo info) {
        String body = "Engine name: " + info.name + "\n\n"
                + (info.online
                    ? ONLINE_CAUTION + ". The words of the "
                      + "document are sent over the internet to "
                      + "be turned into speech for this voice."
                    : "This voice runs on this device \u2014 "
                      + "the reading stays on the device; "
                      + "nothing is sent anywhere to speak it.");
        new AlertDialog.Builder(getContext())
                .setTitle(info.label)
                .setMessage(body)
                .setPositiveButton("OK", null)
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
        /* Build H (QUALITY baseline B5): the key field's hint
           rendered in the theme's faintest grey — the one field
           a paying customer must find and fill was the hardest
           thing on the page to see. It now stands as a field:
           white face, a visible edge, dark text, and a hint in
           the app's readable mid-grey. */
        keyInput.setTextColor(0xFF10243E);
        keyInput.setHintTextColor(0xFF5A6B7F);
        keyInput.setTextSize(14);
        keyInput.setPadding(dp(12), dp(10), dp(12), dp(10));
        android.graphics.drawable.GradientDrawable keyBg =
                new android.graphics.drawable.GradientDrawable();
        keyBg.setColor(0xFFFFFFFF);
        keyBg.setCornerRadius(dp(8));
        keyBg.setStroke(dp(1), 0xFF9FB8D8);
        keyInput.setBackground(keyBg);
        body.addView(keyInput);
        Button verify = new Button(getContext());
        verify.setText("Save & verify key");
        verify.setAllCaps(false);
        verify.setOnClickListener(v -> {
            String token = keyInput.getText().toString().trim();
            if (token.isEmpty()) {
                /* Build I (Q-H1, the general law): an act
                   that cannot proceed answers IN PLACE — an
                   empty field tapped "Save & verify" used to
                   return in silence, indistinguishable from a
                   broken button. */
                renderLicenceState("Paste a licence key first "
                        + "\u2014 the field above is empty; nothing "
                        + "was checked.");
                return;
            }
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
            TierRow row = tierRows.get(tier.id);
            Button action = tierButtons.get(tier.id);
            if (row == null || action == null) continue;
            String tierState = tierStates.get(tier.id);
            /* Build I (Q-H2): head and state are separate
               views now (see TierRow) — the head carries the
               model's name and size; the state stands on its
               own full-width line under it, so the longest
               clause (the held models' reason) wraps inside
               the card's natural height and is never clipped
               against the chip's row. */
            row.head.setText(tier.label + " \u00B7 " + sizeLabel(tier.bytes));
            if (!tier.runnable) {
                row.state.setText("Not offered yet \u2014 it needs more "
                        + "memory than the in-app engine can safely use.");
                action.setText("Held");
                /* Build F (Q-2): ENABLED. A chip shaped as a
                   button answers its tap — with its reason
                   (tierAction). Build E disabled these, so the
                   tap died in silence and the chip read as a
                   broken button. There are no bare disabled
                   states on this surface: the two remaining
                   disabled renderings (Checking\u2026, Downloading\u2026)
                   are live progress, self-resolving and
                   re-queried on every render pass. */
                action.setEnabled(true);
            } else if (!unlocked) {
                row.state.setText("Part of the unlock.");
                action.setText("Needs unlock");
                action.setEnabled(true);
            } else if (tierState == null) {
                row.state.setText("Checking\u2026");
                action.setText("\u2026");
                action.setEnabled(false);
                if (host != null) host.status(reqSeq++, tier.id);
            } else if ("downloading".equals(tierState)) {
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
                row.state.setText("Downloading\u2026");
                action.setText("Downloading\u2026");
                action.setEnabled(false);
                if (host != null) host.status(reqSeq++, tier.id);
            } else if ("installed".equals(tierState)) {
                row.state.setText("Installed" + (tier.id.equals(selectedModel)
                        ? " \u00B7 In use" : ""));
                action.setText("Remove");
                action.setEnabled(true);
            } else {
                row.state.setText("Not downloaded");
                action.setText("Download");
                action.setEnabled(true);
            }
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
        TierRow row = tierRows.get(tier.id);
        if (row != null) {
            row.head.setText(tier.label + " \u00B7 " + sizeLabel(tier.bytes));
            row.state.setText(note);
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
            /* Build I (Q-H1): a transient note (an in-place
               answer like the empty-key one) shows on the
               unlocked surface too — this branch used to drop
               it, so the answer existed only for locked and
               unverified users. */
            if (transientNote != null) sb.append(" ").append(transientNote);
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

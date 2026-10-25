package app.getdogear;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.OpenableColumns;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.view.View;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Set;

/**
 * DogEar, redesigned (2026-10-24 commission): a native app, not a
 * web page in a frame. One Activity, three areas on a bottom
 * navigation bar — Listen (usage), Library (program), Settings
 * (admin) — over ONE native state machine (PlayerCore), a native
 * document store, a native chunk feeder, and a function-only
 * engine host for the on-device Whisper pack. The Phase 0 rule
 * governs the whole shell: the transport surface owns its truth —
 * sessions are set by native code, the bar's states give reasons,
 * one machine is commanded directly, and behavior proof runs on
 * the shipped bytes.
 *
 * The previous WebView shell is retired in this build: the web
 * app remains the WEB endpoint (endpoint-native law — it keeps
 * its rich reading view there), and the one retained WebView is
 * EngineHost, hidden and function-only.
 */
public final class MainActivity extends Activity
        implements Shell, SpeechService.EventSink, EngineHost.Listener {

    private static final String PREFS = "dogear_settings";
    private static final int REQ_MIC = 41;
    private static final int REQ_PICK = 42;
    private static final int REQ_NOTIF = 43;
    private static final long MAX_ADD_BYTES = 2_000_000L;

    private Handler main;
    private PlayerCore core;
    private MarksStore marks;
    private DocumentStore documents;
    private Licence licence;
    private Diagnostics diag;
    private NativeFeeder feeder;
    private Announcer announcer;
    private AskEngine ask;
    private EngineHost engineHost;
    private TextToSpeech voiceProbe;

    private FrameLayout content;
    private LinearLayout listenArea;
    private ListenView listenView;
    private NativeControlBar controlBar;
    private LibraryView libraryView;
    private SettingsView settingsView;
    private Button navListen, navLibrary, navSettings;
    private int area = AREA_LISTEN;
    private String openDocId;
    private int licenceReqSeq = 7000;
    private boolean startAreaDecided;

    private final IntSpeaker speaker = new IntSpeaker() {
        @Override
        public void speak(int utteranceId, String text, float rate, String lang) {
            SpeechService s = SpeechService.active();
            if (s != null) {
                s.speakChunk(utteranceId, text, rate, lang);
            } else {
                SpeechService.speak(MainActivity.this, utteranceId, text, rate, lang);
            }
        }
    };

    // ----------------------------------------------------------
    // Lifecycle
    // ----------------------------------------------------------

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        main = new Handler(Looper.getMainLooper());
        core = PlayerCoreProvider.get(this);
        marks = PlayerCoreProvider.marks(this);
        documents = new DocumentStore(DocumentStore.fileStorage(
                new File(getFilesDir(), "dogear-docs")));
        licence = new Licence(this);
        diag = new Diagnostics(getFilesDir());
        diag.event("app-start", null, System.currentTimeMillis());

        announcer = new Announcer(speaker, main, diag,
                what -> listenView.setNote(what));
        feeder = new NativeFeeder(core, documents, speaker, main, diag,
                what -> listenView.setNote(what));
        float rate = speechRate();
        feeder.setSpeechParams(rate, "");
        SpeechService.setVoiceName(savedVoiceName());

        engineHost = new EngineHost(this, BundledAssets.loader(this), licence, main);
        engineHost.setListener(this);

        ask = new AskEngine(core, documents, announcer, engineHost, licence, diag);
        ask.setSpeechParams(rate, "");
        ask.setAnnouncementResumeHook(() -> feeder.resumeAfterAnnouncement());
        ask.setSteering((chunk, playAfter) -> steerInternal(chunk, playAfter));

        buildLayout();

        core.setListener(coreListener);
        SpeechService.setEventSink(this);
        requestNotificationPermission();

        if (Migration.needed(this, documents)) {
            Migration.run(this, BundledAssets.loader(this), documents, marks,
                    main, (imported, licenceToken) -> {
                        diagEvent("migration", "docs", imported);
                        if (licenceToken != null) {
                            licence.store(licenceToken);
                            engineHost.verifyLicence(licenceReqSeq++, licenceToken);
                        }
                        libraryView.refresh();
                        decideStartArea();
                    });
        } else {
            decideStartArea();
        }
        // The core's standing snapshot renders the first frame.
        main.post(() -> coreListener.onSnapshot(core.snapshot()));
    }

    @Override
    protected void onDestroy() {
        SpeechService.setEventSink(null);
        if (feeder != null) feeder.halt();
        if (announcer != null) announcer.cancel();
        if (engineHost != null) engineHost.destroy();
        if (voiceProbe != null) {
            voiceProbe.shutdown();
            voiceProbe = null;
        }
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (area != AREA_LISTEN) {
            showArea(AREA_LISTEN);
        } else {
            super.onBackPressed();
        }
    }

    // ----------------------------------------------------------
    // Layout + navigation
    // ----------------------------------------------------------

    private void buildLayout() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xFFF4F8FD);

        content = new FrameLayout(this);
        root.addView(content, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        listenArea = new LinearLayout(this);
        listenArea.setOrientation(LinearLayout.VERTICAL);
        listenView = new ListenView(this, this);
        listenArea.addView(listenView, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));
        controlBar = new NativeControlBar(this, core);
        controlBar.setChooseDocumentAction(() -> showArea(AREA_LIBRARY));
        listenArea.addView(controlBar);
        content.addView(listenArea);

        libraryView = new LibraryView(this, this);
        libraryView.setVisibility(View.GONE);
        content.addView(libraryView);

        settingsView = new SettingsView(this, this);
        settingsView.setVisibility(View.GONE);
        content.addView(settingsView);

        // The engine host's WebView: attached (so its JS runs at
        // full fidelity) but invisible and 1px — it renders
        // nothing, ever, by design.
        android.webkit.WebView hostView = engineHost.view();
        hostView.setAlpha(0f);
        content.addView(hostView, new FrameLayout.LayoutParams(1, 1));

        LinearLayout nav = new LinearLayout(this);
        nav.setOrientation(LinearLayout.HORIZONTAL);
        nav.setBackgroundColor(0xFF10243E);
        navListen = navButton("Listen", AREA_LISTEN);
        navLibrary = navButton("Library", AREA_LIBRARY);
        navSettings = navButton("Settings", AREA_SETTINGS);
        nav.addView(navListen);
        nav.addView(navLibrary);
        nav.addView(navSettings);
        root.addView(nav);

        setContentView(root);
        renderNav();
    }

    private Button navButton(String label, final int target) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(15f);
        b.setLayoutParams(new LinearLayout.LayoutParams(
                0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        b.setOnClickListener(v -> showArea(target));
        return b;
    }

    private void renderNav() {
        Button[] all = {navListen, navLibrary, navSettings};
        for (int i = 0; i < all.length; i++) {
            boolean active = i == area;
            all[i].setTextColor(active ? 0xFFFFFFFF : 0xFF9FB8D8);
            all[i].setTypeface(null, active
                    ? android.graphics.Typeface.BOLD
                    : android.graphics.Typeface.NORMAL);
        }
    }

    @Override
    public void showArea(int target) {
        area = target;
        listenArea.setVisibility(target == AREA_LISTEN ? View.VISIBLE : View.GONE);
        libraryView.setVisibility(target == AREA_LIBRARY ? View.VISIBLE : View.GONE);
        settingsView.setVisibility(target == AREA_SETTINGS ? View.VISIBLE : View.GONE);
        if (target == AREA_LIBRARY) libraryView.refresh();
        if (target == AREA_SETTINGS) {
            settingsView.refresh();
            probeVoices();
        }
        renderNav();
    }

    private void decideStartArea() {
        if (startAreaDecided) return;
        startAreaDecided = true;
        boolean hasPlace = marks != null && marks.hasAnyPosition();
        showArea(hasPlace || !documents.isEmpty()
                ? AREA_LISTEN : AREA_LIBRARY);
    }

    // ----------------------------------------------------------
    // Shell: document actions
    // ----------------------------------------------------------

    @Override
    public void openDocument(String docId) {
        openInternal(docId, -1, true);
    }

    private void openInternal(String docId, int seedChunk, boolean play) {
        DocumentStore.Doc doc = documents.find(docId);
        if (doc == null) {
            Toast.makeText(this, "That document is no longer in the Library.",
                    Toast.LENGTH_LONG).show();
            showArea(AREA_LIBRARY);
            return;
        }
        List<String> chunks = documents.chunksOf(docId);
        if (chunks.isEmpty()) {
            Toast.makeText(this, "That document has nothing readable in it.",
                    Toast.LENGTH_LONG).show();
            return;
        }
        feeder.halt();
        announcer.cancel();
        int seed = seedChunk;
        if (seed < 0) {
            JSONObject pos = marks.positionFor(docId);
            seed = pos == null ? 0 : pos.optInt("chunk", 0);
        }
        seed = Math.max(0, Math.min(seed, chunks.size() - 1));
        openDocId = docId;
        core.sessionStarted(docId, doc.title, seed, chunks.size());
        listenView.renderDocument(docId, doc.title, chunks);
        showArea(AREA_LISTEN);
        diagEvent("document-open", "doc", docId);
        if (play) {
            // Posted after the session lands (the core serializes
            // on the same looper): play emits the control the
            // feeder follows.
            main.post(() -> core.play(PlayerCore.Source.BAR));
        }
    }

    @Override
    public void removeDocument(String docId) {
        boolean wasOpen = docId != null && docId.equals(openDocId);
        if (wasOpen) {
            feeder.halt();
            announcer.cancel();
            core.stop(PlayerCore.Source.BAR);
            // D-3 (2026-10-25): the open document's marks purge
            // runs inside the core's queue (sessionEndedForget) \u2014
            // the queued stop() saves the place first, the purge
            // lands after it. A synchronous purge here loses that
            // race and the removed document's place resurrects.
            core.sessionEndedForget(docId);
            openDocId = null;
            listenView.renderEmpty();
        }
        documents.remove(docId);
        if (!wasOpen) {
            marks.deleteDocument(docId);
        }
        diagEvent("document-removed", "doc", docId);
        Toast.makeText(this, "Removed.", Toast.LENGTH_SHORT).show();
    }

    @Override
    public void steerToChunk(int chunk) {
        steerInternal(chunk, isPlaying());
    }

    private void steerInternal(int chunk, boolean playAfter) {
        JSONObject snap = core.snapshot();
        String docId = snap.isNull("docId") ? null : snap.optString("docId", null);
        if (docId == null) return;
        DocumentStore.Doc doc = documents.find(docId);
        if (doc == null) return;
        int total = snap.optInt("chunks", 0);
        int target = Math.max(0, Math.min(chunk, Math.max(0, total - 1)));
        feeder.halt();
        core.sessionStarted(docId, doc.title, target, total);
        if (playAfter) {
            main.post(() -> feeder.startFromSnapshot());
        }
    }

    private boolean isPlaying() {
        return "playing".equals(core.snapshot().optString("playback", ""));
    }

    @Override
    public void pickDocumentFile() {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("text/*");
        try {
            startActivityForResult(i, REQ_PICK);
        } catch (Exception e) {
            Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
            fallback.setType("text/*");
            fallback.addCategory(Intent.CATEGORY_OPENABLE);
            startActivityForResult(fallback, REQ_PICK);
        }
    }

    @Override
    public void addPastedText(String title, String text) {
        DocumentStore.Doc doc = documents.add(title, "text", text,
                System.currentTimeMillis());
        diagEvent("document-added", "doc", doc.id);
        openDocument(doc.id);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_PICK || resultCode != RESULT_OK
                || data == null || data.getData() == null) {
            return;
        }
        Uri uri = data.getData();
        try {
            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) throw new Exception("no stream");
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            long total = 0;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > MAX_ADD_BYTES) {
                    Toast.makeText(this, "That file is too large for this "
                            + "build (2 MB of text at most).",
                            Toast.LENGTH_LONG).show();
                    in.close();
                    return;
                }
                out.write(buf, 0, n);
            }
            in.close();
            String text = new String(out.toByteArray(), StandardCharsets.UTF_8);
            if (text.indexOf('\0') >= 0) {
                Toast.makeText(this, "That file is not plain text. In this "
                        + "build, Add takes text files; PDF, EPUB, Word and "
                        + "HTML live on DogEar's web app for now.",
                        Toast.LENGTH_LONG).show();
                return;
            }
            String name = displayName(uri);
            DocumentStore.Doc doc = documents.add(name, "text", text,
                    System.currentTimeMillis());
            diagEvent("document-added", "doc", doc.id);
            openDocument(doc.id);
        } catch (Exception e) {
            Toast.makeText(this, "That file could not be read.",
                    Toast.LENGTH_LONG).show();
        }
    }

    private String displayName(Uri uri) {
        try {
            Cursor c = getContentResolver().query(uri, null, null, null, null);
            if (c != null) {
                int idx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0 && c.moveToFirst()) {
                    String name = c.getString(idx);
                    c.close();
                    if (name != null && !name.isEmpty()) {
                        return name.replaceAll("\\.[A-Za-z0-9]{1,5}$", "");
                    }
                }
                c.close();
            }
        } catch (Exception ignored) {}
        return null;
    }

    // ----------------------------------------------------------
    // Shell: speech settings
    // ----------------------------------------------------------

    @Override
    public float speechRate() {
        SharedPreferences p = getSharedPreferences(PREFS, MODE_PRIVATE);
        return p.getFloat("rate", 1.0f);
    }

    @Override
    public String speechLang() {
        return "";
    }

    private String savedVoiceName() {
        return getSharedPreferences(PREFS, MODE_PRIVATE)
                .getString("voiceName", null);
    }

    @Override
    public void setSpeechRate(float rate) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putFloat("rate", rate).apply();
        feeder.setSpeechParams(rate, "");
        ask.setSpeechParams(rate, "");
    }

    @Override
    public void setSpeechVoice(String voiceName) {
        getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                .putString("voiceName", voiceName).apply();
        SpeechService.setVoiceName(voiceName);
    }

    private void probeVoices() {
        if (voiceProbe != null) return;
        voiceProbe = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS || voiceProbe == null) return;
            try {
                Set<Voice> voices = voiceProbe.getVoices();
                List<String> names = new ArrayList<String>();
                if (voices != null) {
                    for (Voice v : voices) names.add(v.getName());
                }
                Collections.sort(names);
                String current = savedVoiceName();
                if (current == null && voiceProbe.getVoice() != null) {
                    current = voiceProbe.getVoice().getName();
                }
                settingsView.setVoices(names, current);
            } catch (Exception ignored) {}
        });
    }

    // ----------------------------------------------------------
    // Shell: accessors
    // ----------------------------------------------------------

    @Override public PlayerCore core() { return core; }
    @Override public DocumentStore documents() { return documents; }
    @Override public MarksStore marks() { return marks; }
    @Override public Licence licence() { return licence; }
    @Override public EngineHost engineHost() { return engineHost; }

    // ----------------------------------------------------------
    // Core listener
    // ----------------------------------------------------------

    private final PlayerCore.Listener coreListener = new PlayerCore.Listener() {
        @Override
        public void onSnapshot(JSONObject snapshot) {
            diag.snapshot(snapshot, System.currentTimeMillis());
            controlBar.render(snapshot);
            String doc = snapshot.isNull("docId")
                    ? null : snapshot.optString("docId", null);
            if (doc != null && !doc.equals(openDocId)) {
                openDocId = doc;
                DocumentStore.Doc d = documents.find(doc);
                if (d != null) {
                    listenView.renderDocument(doc, d.title,
                            documents.chunksOf(doc));
                }
            }
            if (doc == null && openDocId != null) {
                openDocId = null;
                listenView.renderEmpty();
            }
            listenView.renderState(snapshot);
        }

        @Override
        public void onPageEvent(JSONObject event) {
            String t = event.optString("t", "");
            if ("audio".equals(t)) {
                ask.onAudio(event.optString("b64", ""),
                        event.optBoolean("resumeAfter", false));
            } else if ("audioError".equals(t)) {
                ask.onAudioError(event.optString("class", "error"),
                        event.optBoolean("resumeAfter", false));
            } else if ("continue".equals(t)) {
                String docId = event.optString("docId", "");
                int chunk = event.optInt("chunk", 0);
                if (!docId.isEmpty()) openInternal(docId, chunk, true);
            } else if ("marks".equals(t)) {
                if (openDocId != null) listenView.renderMarks(openDocId);
                if (area == AREA_LIBRARY) libraryView.refresh();
            } else if ("control".equals(t)) {
                // The core's control channel rides page events:
                // {t:"control", action:"play"|"pause"|...}.
                feeder.onControl(event.optString("action", ""));
            }
        }

        @Override
        public void onToast(String message) {
            Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show();
        }

        @Override
        public void onMicPermissionNeeded() {
            if (Build.VERSION.SDK_INT >= 23
                    && checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED) {
                try {
                    requestPermissions(
                            new String[]{Manifest.permission.RECORD_AUDIO},
                            REQ_MIC);
                    return;
                } catch (Exception ignored) {}
            }
            core.capturePermissionDenied();
        }
    };

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_MIC) {
            boolean granted = results.length > 0
                    && results[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                core.talkStart(PlayerCore.Source.BAR);
            } else {
                core.capturePermissionDenied();
            }
        }
    }

    // ----------------------------------------------------------
    // Speech service events
    // ----------------------------------------------------------

    @Override
    public void onSpeechEvent(final String json) {
        runOnUiThread(() -> {
            try {
                JSONObject ev = new JSONObject(json);
                String t = ev.optString("t", "");
                if ("start".equals(t) || "end".equals(t) || "error".equals(t)) {
                    int id = ev.optInt("id", -1);
                    if ("start".equals(t)) {
                        feeder.onUtteranceStarted(id);
                        announcer.onUtteranceStarted(id);
                    } else if ("end".equals(t)) {
                        feeder.onUtteranceEnded(id);
                        announcer.onUtteranceEnded(id);
                    } else {
                        feeder.onUtteranceError(id);
                        announcer.onUtteranceError(id);
                    }
                } else if ("focus".equals(t)) {
                    if (!ev.optBoolean("gained", true)) core.focusLost();
                }
            } catch (Exception ignored) {}
        });
    }

    // ----------------------------------------------------------
    // Engine host events
    // ----------------------------------------------------------

    @Override
    public void onEngineEvent(JSONObject event) {
        String kind = event.optString("kind", "");
        if ("transcript".equals(kind)) {
            ask.onEngineEvent(event);
            return;
        }
        if ("licence".equals(kind)) {
            if (event.optBoolean("ok", false)) {
                JSONObject payload = event.optJSONObject("payload");
                licence.markVerified(payload);
                diagEvent("licence-verified", "plan",
                        payload == null ? "" : payload.optString("plan", ""));
            } else {
                diagEvent("licence-rejected", "reason",
                        event.optString("reason", ""));
            }
        }
        if (settingsView != null) settingsView.onEngineEvent(event);
    }

    // ----------------------------------------------------------
    // Small helpers
    // ----------------------------------------------------------

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            try {
                requestPermissions(
                        new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQ_NOTIF);
            } catch (Exception ignored) {}
        }
    }

    private void diagEvent(String name, String key, Object value) {
        try {
            JSONObject d = new JSONObject();
            d.put(key, value);
            diag.event(name, d, System.currentTimeMillis());
        } catch (Exception ignored) {}
    }
}

package app.getdogear;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

/**
 * PlayerCore transitions — the beta.5 scaffolding contract, proven
 * on the JVM (the core is Android-free; speech/capture/storage are
 * fakes). The legs mirror the owner's phone findings:
 *   - presses are idempotent verbs, never toggle echoes;
 *   - silence is ordered BEFORE the microphone opens;
 *   - position persists on every chunk (Continue is exact);
 *   - the eight features land in the store, timestamped to place.
 */
public class PlayerCoreTest {

    static final class FakeSpeech implements PlayerCore.SpeechPort {
        final List<String> log;
        int pauses, resumes, stops;
        FakeSpeech(List<String> log) { this.log = log; }
        @Override public void pauseVoice() { pauses++; log.add("speech.pause"); }
        @Override public void resumeVoice() { resumes++; log.add("speech.resume"); }
        @Override public void stopVoice() { stops++; log.add("speech.stop"); }
    }

    static final class FakeCapture implements PlayerCore.CapturePort {
        final List<String> log;
        Callback cb;
        int starts, stops;
        FakeCapture(List<String> log) { this.log = log; }
        @Override public void start(Callback cb) {
            starts++; this.cb = cb; log.add("capture.start");
        }
        @Override public void stop() { stops++; log.add("capture.stop"); }
    }

    static final class MemoryStorage implements MarksStore.Storage {
        String data;
        @Override public String read() { return data; }
        @Override public void write(String contents) { data = contents; }
    }

    static final class RecordingListener implements PlayerCore.Listener {
        final List<JSONObject> snapshots = new ArrayList<JSONObject>();
        final List<JSONObject> pageEvents = new ArrayList<JSONObject>();
        final List<String> toasts = new ArrayList<String>();
        int micPrompts;
        @Override public void onSnapshot(JSONObject s) { snapshots.add(s); }
        @Override public void onPageEvent(JSONObject e) { pageEvents.add(e); }
        @Override public void onToast(String m) { toasts.add(m); }
        @Override public void onMicPermissionNeeded() { micPrompts++; }
        List<JSONObject> eventsOfType(String t) {
            List<JSONObject> out = new ArrayList<JSONObject>();
            for (JSONObject e : pageEvents) if (t.equals(e.optString("t"))) out.add(e);
            return out;
        }
        List<JSONObject> controls(String action) {
            List<JSONObject> out = new ArrayList<JSONObject>();
            for (JSONObject e : eventsOfType("control")) {
                if (action.equals(e.optString("action"))) out.add(e);
            }
            return out;
        }
    }

    private List<String> order;
    private FakeSpeech speech;
    private FakeCapture capture;
    private MemoryStorage storage;
    private MarksStore store;
    private RecordingListener listener;
    private PlayerCore core;

    @Before
    public void setUp() {
        order = new ArrayList<String>();
        speech = new FakeSpeech(order);
        capture = new FakeCapture(order);
        storage = new MemoryStorage();
        store = new MarksStore(storage);
        listener = new RecordingListener();
        core = new PlayerCore(store, capture,
                new PlayerCore.Poster() {
                    @Override public void post(Runnable r) { r.run(); }
                },
                new PlayerCore.Clock() {
                    @Override public long nowMs() { return 1700000000000L; }
                });
        core.attachSpeech(speech);
        core.setListener(listener);
        core.sessionStarted("doc1", "A Document", -1, 0);
    }

    private void speakChunk(int i, int n) { core.utteranceSpoke(i, n); }

    @Test
    public void newSessionDoesNotInheritPlaying() {
        // Exercise D-2 (2026-10-24): switching documents mid-
        // utterance left the old session's PLAYING standing, the
        // host's play() no-opped, and the new document never fed
        // — the bar claimed playing over silence. A new session
        // starts STOPPED; its first spoken chunk raises PLAYING.
        speakChunk(2, 10);
        assertEquals(PlayerCore.Playback.PLAYING, core.playback());
        core.sessionStarted("doc2", "Second Document", 0, 5);
        assertEquals(PlayerCore.Playback.STOPPED, core.playback());
        core.play(PlayerCore.Source.BAR);
        assertEquals(1, listener.controls("play").size());
    }

    @Test
    public void removingOpenDocumentPurgesPlaceBehindQueuedSaves() {
        // Exercise D-3 (2026-10-25): removing the OPEN, playing
        // document left its position in the marks store \u2014 stop()
        // persists the place from inside the poster queue, so a
        // purge issued synchronously by the host was undone when
        // the queued save landed after it. The forget must run
        // inside the queue, behind the saves it has to outlast.
        final java.util.ArrayDeque<Runnable> queue =
                new java.util.ArrayDeque<Runnable>();
        PlayerCore q = new PlayerCore(store, capture,
                new PlayerCore.Poster() {
                    @Override public void post(Runnable r) { queue.add(r); }
                },
                new PlayerCore.Clock() {
                    @Override public long nowMs() { return 1700000000000L; }
                });
        q.attachSpeech(speech);
        q.setListener(listener);
        q.sessionStarted("docX", "Doomed Document", 0, 10);
        while (!queue.isEmpty()) queue.poll().run();
        q.utteranceSpoke(4, 10);
        while (!queue.isEmpty()) queue.poll().run();
        assertTrue(store.positionFor("docX") != null);
        // The host's removal order: stop, then the forget \u2014 with
        // NO synchronous purge in between.
        q.stop(PlayerCore.Source.BAR);
        q.sessionEndedForget("docX");
        while (!queue.isEmpty()) queue.poll().run();
        assertTrue(store.positionFor("docX") == null);
        assertFalse(store.hasAnyPosition());
    }

    @Test
    public void pauseIsIdempotentAndEchoesOnceToThePage() {
        speakChunk(3, 40);
        core.pause(PlayerCore.Source.BAR);
        core.pause(PlayerCore.Source.BAR);
        core.pause(PlayerCore.Source.MEDIA);
        assertEquals(1, speech.pauses);
        assertEquals(PlayerCore.Playback.PAUSED, core.playback());
        assertEquals(1, listener.controls("pause").size());
    }

    @Test
    public void pageCommandsDoNotEchoBackToThePage() {
        speakChunk(0, 10);
        core.pause(PlayerCore.Source.PAGE);
        assertEquals(1, speech.pauses);
        assertEquals(0, listener.controls("pause").size());
        core.resume(PlayerCore.Source.PAGE);
        assertEquals(1, speech.resumes);
        assertEquals(0, listener.controls("resume").size());
    }

    @Test
    public void resumeActsOnlyFromPaused() {
        speakChunk(0, 10);
        core.resume(PlayerCore.Source.BAR); // playing: no-op
        assertEquals(0, speech.resumes);
        core.pause(PlayerCore.Source.BAR);
        core.resume(PlayerCore.Source.BAR);
        core.resume(PlayerCore.Source.BAR); // playing again: no-op
        assertEquals(1, speech.resumes);
        assertEquals(PlayerCore.Playback.PLAYING, core.playback());
    }

    @Test
    public void positionPersistsOnEveryChunk() {
        speakChunk(0, 12);
        speakChunk(1, 12);
        speakChunk(7, 12);
        JSONObject pos = store.positionFor("doc1");
        assertEquals(7, pos.optInt("chunk"));
        assertEquals(12, pos.optInt("chunks"));
        assertEquals(null, store.savedFor("doc1")); // no pin from live reading
        assertEquals(7, core.chunk());
    }

    @Test
    public void stopKeepsThePlace() {
        speakChunk(5, 20);
        core.stop(PlayerCore.Source.BAR);
        assertEquals(1, speech.stops);
        assertEquals(PlayerCore.Playback.STOPPED, core.playback());
        assertEquals(5, store.positionFor("doc1").optInt("chunk"));
        assertEquals(1, listener.controls("stop").size());
    }

    @Test
    public void silenceIsOrderedBeforeTheMicrophoneOpens() {
        speakChunk(2, 30);
        order.clear();
        listener.pageEvents.clear();
        core.talkStart(PlayerCore.Source.BAR);
        assertEquals(PlayerCore.Voice.LISTENING, core.voice());
        assertEquals(PlayerCore.Playback.PAUSED, core.playback());
        assertTrue(order.indexOf("speech.pause") >= 0);
        assertTrue(order.indexOf("capture.start") > order.indexOf("speech.pause"));
        // The page's reader is parked too (its held chunk is the
        // resume point for the post-capture flow).
        assertEquals(1, listener.controls("pause").size());
    }

    @Test
    public void toggleDecidesFromCurrentTruthNotSurfaceCache() {
        // Build F (U-1): the bar used to decide pause-vs-resume
        // from its own cached rendering and call that verb; a
        // press against a stale render called a verb that
        // no-ops silently (resume while playing emits nothing),
        // so the press vanished \u2014 the seat's "pause did not
        // hold". The toggle decides inside the queue from the
        // machine's current state: every press lands.
        speakChunk(2, 30); // PLAYING
        core.togglePlayPause(PlayerCore.Source.BAR);
        assertEquals(PlayerCore.Playback.PAUSED, core.playback());
        assertEquals(1, speech.pauses);
        core.togglePlayPause(PlayerCore.Source.BAR);
        assertEquals(PlayerCore.Playback.PLAYING, core.playback());
        assertEquals(1, speech.resumes);
        // A press that arrives after the state moved on (the
        // chunk advanced between render and press) still acts
        // on the state as it IS, never as it was rendered.
        core.togglePlayPause(PlayerCore.Source.BAR);
        assertEquals(PlayerCore.Playback.PAUSED, core.playback());
        assertEquals(2, speech.pauses);
    }

    static final class FakeGate implements PlayerCore.TalkGate {
        String blockClass;   // non-null: blocked with this class
        boolean hold;        // hold the verdict until released
        Callback held;
        int checks;
        @Override public void check(Callback cb) {
            checks++;
            if (hold) { held = cb; return; }
            if (blockClass != null) cb.blocked(blockClass);
            else cb.proceed();
        }
    }

    @Test
    public void talkGateBlocksCaptureAndSpeaksTheReasonFirst() {
        // Build F (U-6): with no voice model installed, Talk
        // opened the mic and listened ~20 s in silence, and the
        // pack-absent reason was spoken only afterwards. The
        // gate must speak the reason BEFORE any capture \u2014 and
        // capture must never start.
        FakeGate gate = new FakeGate();
        gate.blockClass = "pack-absent";
        core.setTalkGate(gate);
        speakChunk(2, 30); // PLAYING
        order.clear();
        listener.pageEvents.clear();
        core.talkStart(PlayerCore.Source.BAR);
        assertEquals(1, gate.checks);
        assertEquals(0, capture.starts);              // never opened
        assertEquals(PlayerCore.Voice.IDLE, core.voice());
        // Playback was silenced for the press, as always\u2026
        assertEquals(1, speech.pauses);
        // \u2026and the failure reaches the page as an audio
        // error carrying the resume discipline (announce the
        // reason, then resume) \u2014 before any capture existed.
        List<JSONObject> errs = listener.eventsOfType("audioError");
        assertEquals(1, errs.size());
        assertEquals("pack-absent", errs.get(0).optString("class"));
        assertTrue(errs.get(0).optBoolean("resumeAfter"));
    }

    @Test
    public void talkGateProceedKeepsSilenceBeforeMicrophone() {
        FakeGate gate = new FakeGate(); // proceeds
        core.setTalkGate(gate);
        speakChunk(2, 30);
        order.clear();
        core.talkStart(PlayerCore.Source.BAR);
        assertEquals(1, capture.starts);
        assertEquals(PlayerCore.Voice.LISTENING, core.voice());
        assertTrue(order.indexOf("speech.pause") >= 0);
        assertTrue(order.indexOf("capture.start") > order.indexOf("speech.pause"));
    }

    @Test
    public void talkGateVerdictAfterCancelIsIgnored() {
        FakeGate gate = new FakeGate();
        gate.hold = true;
        core.setTalkGate(gate);
        speakChunk(2, 30); // PLAYING
        core.talkStart(PlayerCore.Source.BAR);
        assertEquals(PlayerCore.Playback.PAUSED, core.playback());
        core.talkStop(); // user cancels while the gate decides
        // The silenced playback is given back, capture never
        // opened, and the gate's late verdict changes nothing.
        assertEquals(PlayerCore.Playback.PLAYING, core.playback());
        assertEquals(1, speech.resumes);
        gate.held.proceed();
        assertEquals(0, capture.starts);
        assertEquals(PlayerCore.Voice.IDLE, core.voice());
    }

    @Test
    public void pageStartedTalkDoesNotRePause() {
        speakChunk(2, 30);
        core.pause(PlayerCore.Source.PAGE); // the page parks first, as its flow does
        listener.pageEvents.clear();
        speech.pauses = 0;
        core.talkStart(PlayerCore.Source.PAGE);
        assertEquals(PlayerCore.Voice.LISTENING, core.voice());
        assertEquals(0, speech.pauses); // no second silence, no echo
        assertEquals(0, listener.controls("pause").size());
    }

    @Test
    public void capturedAudioReachesThePageAsPcmBase64() {
        speakChunk(2, 30);
        core.talkStart(PlayerCore.Source.BAR);
        short[] samples = new short[]{0, 1, -1, 32767, -32768, 12345};
        capture.cb.onCaptured(samples, 16000);
        List<JSONObject> audio = listener.eventsOfType("audio");
        assertEquals(1, audio.size());
        assertTrue(audio.get(0).optBoolean("resumeAfter"));
        assertEquals(16000, audio.get(0).optInt("sampleRate"));
        byte[] bytes = java.util.Base64.getDecoder().decode(audio.get(0).optString("b64"));
        assertEquals(samples.length * 2, bytes.length);
        for (int i = 0; i < samples.length; i++) {
            int v = (bytes[i * 2] & 0xff) | (bytes[i * 2 + 1] << 8);
            assertEquals(samples[i], (short) v);
        }
        assertEquals(PlayerCore.Voice.IDLE, core.voice());
    }

    @Test
    public void captureErrorClassesReachThePage() {
        speakChunk(0, 5);
        core.talkStart(PlayerCore.Source.BAR);
        capture.cb.onCaptureError("busy");
        List<JSONObject> errs = listener.eventsOfType("audioError");
        assertEquals(1, errs.size());
        assertEquals("busy", errs.get(0).optString("class"));
        assertEquals(PlayerCore.Voice.IDLE, core.voice());
    }

    @Test
    public void permissionNeededPromptsAndNeverReportsBlocked() {
        speakChunk(0, 5);
        core.talkStart(PlayerCore.Source.BAR);
        capture.cb.onCaptureError("permission-needed");
        assertEquals(1, listener.micPrompts);
        assertEquals(0, listener.eventsOfType("audioError").size());
        core.capturePermissionDenied();
        List<JSONObject> errs = listener.eventsOfType("audioError");
        assertEquals(1, errs.size());
        assertEquals("permission", errs.get(0).optString("class"));
    }

    @Test
    public void marksLandInTheStoreAtTheCurrentChunk() {
        speakChunk(9, 50);
        core.addBookmark("the good part", PlayerCore.Source.BAR);
        core.addTag("motors", PlayerCore.Source.BAR);
        core.addNote("check this figure", PlayerCore.Source.BAR);
        core.toggleFavorite(PlayerCore.Source.BAR);
        JSONObject marks = store.marksFor("doc1");
        assertTrue(marks.optBoolean("favorite"));
        assertEquals(1, marks.optJSONArray("bookmarks").length());
        assertEquals(9, marks.optJSONArray("bookmarks").optJSONObject(0).optInt("chunk"));
        assertEquals("the good part",
                marks.optJSONArray("bookmarks").optJSONObject(0).optString("label"));
        assertEquals("motors",
                marks.optJSONArray("tags").optJSONObject(0).optString("tag"));
        assertEquals("check this figure",
                marks.optJSONArray("notes").optJSONObject(0).optString("text"));
        assertEquals(4, listener.eventsOfType("marks").size());
    }

    @Test
    public void savePlacePinsAndContinuePrefersThePin() {
        speakChunk(4, 90);
        core.savePlace(PlayerCore.Source.BAR);
        assertEquals(4, store.savedFor("doc1").optInt("chunk"));
        speakChunk(8, 90); // live reading moves on; the pin must not
        assertEquals(8, store.positionFor("doc1").optInt("chunk"));
        assertEquals(4, store.savedFor("doc1").optInt("chunk"));
        listener.pageEvents.clear();
        core.continueSaved(PlayerCore.Source.BAR);
        List<JSONObject> cont = listener.eventsOfType("continue");
        assertEquals(1, cont.size());
        assertEquals("doc1", cont.get(0).optString("docId"));
        assertEquals(4, cont.get(0).optInt("chunk")); // the pin, exactly
        assertTrue(cont.get(0).optBoolean("pinned"));
    }

    @Test
    public void coldContinuePrefersThePinOfTheMostRecentDocument() {
        speakChunk(4, 90);
        core.savePlace(PlayerCore.Source.BAR); // pin at chunk 4
        speakChunk(15, 90);                    // live reading moves far past it
        core.sessionEnded();                   // cold: no live session
        listener.pageEvents.clear();
        core.continueSaved(PlayerCore.Source.BAR);
        List<JSONObject> cont = listener.eventsOfType("continue");
        assertEquals(1, cont.size());
        assertEquals(4, cont.get(0).optInt("chunk")); // the pin, not part 16
        assertTrue(cont.get(0).optBoolean("pinned"));
    }

    @Test
    public void continueWithNoSessionOffersTheMostRecentDocument() {
        speakChunk(6, 40);
        core.sessionEnded();
        listener.pageEvents.clear();
        core.play(PlayerCore.Source.BAR);
        List<JSONObject> cont = listener.eventsOfType("continue");
        assertEquals(1, cont.size());
        assertEquals("doc1", cont.get(0).optString("docId"));
        assertEquals(6, cont.get(0).optInt("chunk"));
    }

    @Test
    public void snapshotCarriesTheTruth() {
        speakChunk(11, 42);
        core.toggleFavorite(PlayerCore.Source.BAR);
        JSONObject s = core.snapshot();
        assertEquals("playing", s.optString("playback"));
        assertEquals("idle", s.optString("voice"));
        assertEquals("doc1", s.optString("docId"));
        assertEquals(11, s.optInt("chunk"));
        assertEquals(42, s.optInt("chunks"));
        assertTrue(s.optBoolean("favorite"));
        assertTrue(s.optBoolean("canContinue"));
        assertEquals(11, s.optInt("savedChunk"));
    }

    @Test
    public void storeSurvivesReload() {
        speakChunk(13, 60);
        core.addNote("persisted", PlayerCore.Source.BAR);
        MarksStore reloaded = new MarksStore(storage);
        assertEquals(13, reloaded.positionFor("doc1").optInt("chunk"));
        assertEquals(1, reloaded.marksFor("doc1").optJSONArray("notes").length());
    }
}

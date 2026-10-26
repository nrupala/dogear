package app.getdogear;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * NativeFeeder — the D-18 regression (Build J).
 *
 * Through Build I, a resume issued NO speak of the feeder's own:
 * resumeHeldLocked merely awaited the speech service's retained
 * utterance, whose END event is the feeder's only advance signal.
 * A pause landing before that end destroys the utterance — and
 * its end event — and the next resume restarts the chunk from
 * its beginning, so under any pause/resume cycle shorter than
 * the chunk, the end event never fires and speech never
 * advances (the TESTER seat on Build I: strip series 0/10
 * cycles advanced, the chunk frozen ~87 s, snapshots perfect
 * throughout).
 *
 * The invariant these tests pin: EVERY resume is backed by a
 * feed the feeder itself issues for the held chunk, after ANY
 * pause/resume interleaving — and once a resume is left open,
 * the utterance's end advances the book. On Build I's feeder
 * the speak-count assertions below fail: a resume records no
 * speak at all.
 */
public class NativeFeederTest {

    private static final class MemMarks implements MarksStore.Storage {
        String data;
        @Override public String read() { return data; }
        @Override public void write(String contents) { data = contents; }
    }

    private static final class MemDocs implements DocumentStore.Storage {
        final Map<String, String> map = new HashMap<String, String>();
        @Override public String read(String key) { return map.get(key); }
        @Override public void write(String key, String value) { map.put(key, value); }
        @Override public void delete(String key) { map.remove(key); }
    }

    private static final class FakeSpeech implements PlayerCore.SpeechPort {
        @Override public void pauseVoice() {}
        @Override public void resumeVoice() {}
        @Override public void stopVoice() {}
    }

    private static final class FakeCapture implements PlayerCore.CapturePort {
        @Override public void start(Callback cb) {}
        @Override public void stop() {}
    }

    private static final class DirectPoster implements PlayerCore.Poster {
        @Override public void post(Runnable r) { r.run(); }
        @Override public void postDelayed(Runnable r, long delayMs) {}
    }

    /** Records every speak the feeder issues, in order. */
    private static final class RecordingSpeaker implements IntSpeaker {
        final List<Integer> speaks = new ArrayList<Integer>();
        @Override public void speak(int utteranceId, String text,
                                    float rate, String lang) {
            speaks.add(utteranceId);
        }
    }

    /** The guard clock, manual: ticks happen only when the test
     *  fires them, so no verdict here depends on wall time. */
    private static final class ManualClock implements NativeFeeder.GuardClock {
        final List<Runnable> pending = new ArrayList<Runnable>();
        @Override public void schedule(Runnable r, long delayMs) {
            pending.remove(r);
            pending.add(r);
        }
        @Override public void cancel(Runnable r) { pending.remove(r); }
    }

    private PlayerCore core;
    private NativeFeeder feeder;
    private RecordingSpeaker speaker;
    private String docId;
    private int chunkCount;

    @Before
    public void setUp() {
        MarksStore marks = new MarksStore(new MemMarks());
        core = new PlayerCore(marks, new FakeCapture(), new DirectPoster(),
                new PlayerCore.Clock() {
                    @Override public long nowMs() { return 1000L; }
                });
        core.attachSpeech(new FakeSpeech());
        // The MainActivity fan-out, mirrored: the core's control
        // events drive the feeder.
        core.setListener(new PlayerCore.Listener() {
            @Override public void onSnapshot(JSONObject s) {}
            @Override public void onPageEvent(JSONObject e) {
                if ("control".equals(e.optString("t", ""))) {
                    feeder.onControl(e.optString("action", ""));
                }
            }
            @Override public void onToast(String m) {}
            @Override public void onMicPermissionNeeded() {}
        });
        DocumentStore docs = new DocumentStore(new MemDocs());
        StringBuilder text = new StringBuilder();
        for (int i = 0; i < 12; i++) {
            text.append("Sentence number ").append(i)
                    .append(" carries enough words to stand as its own "
                            + "piece of the reading for this test. ");
        }
        DocumentStore.Doc doc = docs.add("Feeder test", "text",
                text.toString(), 1000L);
        docId = doc.id;
        chunkCount = docs.chunksOf(docId).size();
        assertTrue("fixture must chunk into several pieces", chunkCount >= 3);
        speaker = new RecordingSpeaker();
        feeder = new NativeFeeder(core, docs, speaker, new ManualClock(),
                null, new NativeFeeder.DefectSink() {
                    @Override public void onFeedDefect(String what) {
                        throw new AssertionError("feed defect: " + what);
                    }
                });
        core.sessionStarted(docId, "Feeder test", 0, chunkCount);
    }

    /** Play from a standing start: the feeder feeds chunk 0. */
    private void playToFirstChunk() {
        core.play(PlayerCore.Source.BAR);
        assertEquals(1, speaker.speaks.size());
        assertEquals(Integer.valueOf(0), speaker.speaks.get(0));
        feeder.onUtteranceStarted(0);
    }

    /** The transport press path (Build F): the feeder is halted
     *  synchronously on the press, then the core's verb runs. */
    private void pressToggle() {
        feeder.halt();
        core.togglePlayPause(PlayerCore.Source.BAR);
    }

    @Test
    public void resumeIssuesItsOwnFeedForTheHeldChunk() {
        playToFirstChunk();
        // Pause inside the utterance — the D-18 window: the
        // utterance is destroyed before its end event can fire.
        pressToggle();
        assertEquals("paused",
                core.snapshot().optString("playback", ""));
        assertEquals(1, speaker.speaks.size());
        // Resume: on Build I this recorded NO speak (the feeder
        // only awaited the service's retained chunk). The feed
        // must be the feeder's own, for the held chunk.
        pressToggle();
        assertEquals("playing",
                core.snapshot().optString("playback", ""));
        assertEquals(2, speaker.speaks.size());
        assertEquals(Integer.valueOf(0), speaker.speaks.get(1));
    }

    @Test
    public void rapidPauseResumeInterleavingsNeverOrphanTheVoice() {
        playToFirstChunk();
        // The seat's geometry, five times: pause inside the
        // resume window, resume again. Every resume must add
        // exactly one feeder-issued speak of the held chunk —
        // no silent playing state anywhere in the pattern.
        for (int cycle = 0; cycle < 5; cycle++) {
            pressToggle(); // pause inside the window
            pressToggle(); // resume
            assertEquals("playing",
                    core.snapshot().optString("playback", ""));
            assertEquals(2 + cycle, speaker.speaks.size());
            assertEquals(Integer.valueOf(0),
                    speaker.speaks.get(speaker.speaks.size() - 1));
            feeder.onUtteranceStarted(0);
        }
        // Left open at last, the utterance ends — and the book
        // advances to the next chunk.
        feeder.onUtteranceEnded(0);
        assertEquals(Integer.valueOf(1),
                speaker.speaks.get(speaker.speaks.size() - 1));
        assertEquals(1, core.snapshot().optInt("chunk", -1));
    }
}

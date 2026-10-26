package app.getdogear;

import android.os.Handler;

import org.json.JSONObject;

import java.util.List;

/**
 * Feeds the open document's chunks to the speech service, one at
 * a time, driven by the service's own lifecycle events (redesign
 * FUNCTION). PlayerCore stays the one state machine:
 *   - the feeder starts on the core's control events (play) and
 *     on native opens, feeding at the snapshot's chunk;
 *   - each chunk handed to the voice is reported to the core at
 *     hand-off (utteranceSpoke — the core's position truth, so
 *     the place persists per chunk exactly as it did when the
 *     page reported);
 *   - an "end" event for the awaited chunk feeds the next one;
 *   - pause/stop halt feeding (the core drives the voice itself
 *     for those verbs);
 *   - resume RE-FEEDS the held chunk from the feeder itself
 *     (Build J, defect D-18 — see onControl). Through Build I
 *     resume merely TRUSTED the service's retained chunk: the
 *     feeder issued no speak of its own and only awaited the
 *     retained utterance's events. But the feeder's advance is
 *     driven solely by utterance END events, and a pause inside
 *     the window before that end destroys the utterance — and
 *     its end event — while the next resume restarts the chunk
 *     from its beginning. Under any pause/resume cycle shorter
 *     than the chunk's spoken length the end event therefore
 *     never fires: snapshots flipped perfectly while speech
 *     never advanced and no feed was ever issued (the TESTER
 *     seat's strip series: 0/10 cycles, the chunk frozen for
 *     ~87 s). A resume the state calls playing must be backed
 *     by a feed THIS feeder issued — the same feeder-owned
 *     re-feed resumeAfterAnnouncement() already used, now the
 *     one resume path for every source.
 *
 * Utterance ids are the service's integer space: the feeder's id
 * for a chunk is its chunk index.
 *
 * The F-B5-2 guard, kept: a chunk the engine never starts gets
 * ONE re-feed; a second failure declares the piece lost —
 * recorded in the diagnostics, surfaced on the Listen surface,
 * and feeding continues. A wedged engine stalls one piece,
 * never the book.
 */
public final class NativeFeeder {

    public interface DefectSink {
        void onFeedDefect(String what);
    }

    private static final long START_WINDOW_MS = 4000;
    private static final long GUARD_TICK_MS = 1000;

    /** The guard's clock (Build J): the feeder schedules its
     *  one-second guard tick through this seam — a Handler in
     *  production, a manual clock in the JVM tests, where
     *  android.os.Handler cannot run. The seam exists so the
     *  D-18 regression test can drive the feeder's real code,
     *  not a copy of it. */
    interface GuardClock {
        void schedule(Runnable r, long delayMs);
        void cancel(Runnable r);
    }

    private final PlayerCore core;
    private final DocumentStore docs;
    private final IntSpeaker speaker;
    private final GuardClock guardClock;
    private final Diagnostics diag;
    private final DefectSink defects;

    private String docId;
    private List<String> chunks;
    private int awaitingIdx = -1;
    private boolean awaitingSpoke;
    private int attempts;
    private long deadlineMs;
    private boolean active;
    private float rate = 1.0f;
    private String lang = "";

    private final Runnable guard = new Runnable() {
        @Override public void run() {
            tick();
        }
    };

    public NativeFeeder(PlayerCore core, DocumentStore docs,
                        IntSpeaker speaker, final Handler handler,
                        Diagnostics diag, DefectSink defects) {
        this(core, docs, speaker, new GuardClock() {
            @Override public void schedule(Runnable r, long delayMs) {
                handler.postDelayed(r, delayMs);
            }
            @Override public void cancel(Runnable r) {
                handler.removeCallbacks(r);
            }
        }, diag, defects);
    }

    /** Test seam (Build J): the same feeder, driven by a manual
     *  guard clock on the JVM. */
    NativeFeeder(PlayerCore core, DocumentStore docs,
                 IntSpeaker speaker, GuardClock guardClock,
                 Diagnostics diag, DefectSink defects) {
        this.core = core;
        this.docs = docs;
        this.speaker = speaker;
        this.guardClock = guardClock;
        this.diag = diag;
        this.defects = defects;
    }

    public void setSpeechParams(float speechRate, String speechLang) {
        rate = speechRate;
        lang = speechLang == null ? "" : speechLang;
    }

    // ----------------------------------------------------------
    // Core control events (fanned out by MainActivity)
    // ----------------------------------------------------------

    public synchronized void onControl(String action) {
        if ("play".equals(action)) {
            startFromSnapshotLocked();
        } else if ("resume".equals(action)) {
            /* Build J (D-18): resume is a FEED, issued by the
               feeder itself at the snapshot's chunk — never a
               trust fall on the service's retained chunk (the
               class doc carries the mechanism). The core's
               resumeVoice still re-speaks the service's retained
               piece on its own path; the feeder's speak carries
               the same chunk id and flushes it (QUEUE_FLUSH), so
               exactly one utterance sounds and its events are
               the feeder's own. After ANY pause/resume
               interleaving, a resume the state calls playing is
               backed by a feed in the record — there is no
               window in which a pause can orphan the voice. */
            startFromSnapshotLocked();
        } else if ("pause".equals(action) || "stop".equals(action)) {
            haltLocked();
        } else if ("next".equals(action)) {
            skipLocked(1);
        } else if ("prev".equals(action)) {
            skipLocked(-1);
        }
    }

    /** Begin feeding at the snapshot's position (native opens and
     *  the play control both land here). */
    public synchronized void startFromSnapshot() {
        startFromSnapshotLocked();
    }

    /** After a Talk announcement completes: the service's
     *  retained chunk is the announcement's last piece, so
     *  re-feed the document's held chunk — the flush replaces
     *  the announcement piece before it can sound, and reading
     *  continues at the held place (the feeder's hand-off also
     *  returns the core to PLAYING via utteranceSpoke). */
    public synchronized void resumeAfterAnnouncement() {
        startFromSnapshotLocked();
    }

    public synchronized void halt() {
        haltLocked();
    }

    private void startFromSnapshotLocked() {
        JSONObject snap = core.snapshot();
        String doc = snap.isNull("docId") ? "" : snap.optString("docId", "");
        if (doc.isEmpty() || snap.optInt("chunks", 0) <= 0) {
            haltLocked();
            return;
        }
        if (!doc.equals(docId) || chunks == null) {
            docId = doc;
            chunks = docs.chunksOf(doc);
        }
        if (chunks == null || chunks.isEmpty()) {
            haltLocked();
            return;
        }
        int idx = Math.max(0, Math.min(snap.optInt("chunk", 0),
                chunks.size() - 1));
        active = true;
        feedLocked(idx);
        armGuardLocked();
    }

    private void skipLocked(int delta) {
        if (!active || chunks == null || awaitingIdx < 0) return;
        int target = Math.max(0, Math.min(awaitingIdx + delta,
                chunks.size() - 1));
        if (target == awaitingIdx && delta > 0) {
            // Next on the final chunk: the reading ends here —
            // it ENDS (Build I): the core's Finished state,
            // not a stop the user never pressed.
            haltLocked();
            core.documentFinished(PlayerCore.Source.SYSTEM);
            return;
        }
        feedLocked(target);
    }

    private void haltLocked() {
        active = false;
        awaitingIdx = -1;
        guardClock.cancel(guard);
    }

    private void armGuardLocked() {
        guardClock.cancel(guard);
        guardClock.schedule(guard, GUARD_TICK_MS);
    }

    // ----------------------------------------------------------
    // Speech-service events (fanned out by MainActivity)
    // ----------------------------------------------------------

    public synchronized void onUtteranceStarted(int id) {
        if (!active || id != awaitingIdx) return;
        awaitingSpoke = true;
        int len = (chunks != null && id >= 0 && id < chunks.size())
                ? chunks.get(id).length() : 0;
        deadlineMs = System.currentTimeMillis()
                + Math.max(60000L, (long) len * 300L);
    }

    public synchronized void onUtteranceEnded(int id) {
        if (!active || id != awaitingIdx) return;
        awaitingIdx = -1;
        if (chunks == null) {
            haltLocked();
            return;
        }
        int next = id + 1;
        if (next >= chunks.size()) {
            diagEvent("book-ended", id);
            haltLocked();
            /* Build I (Q-H4): the book is FINISHED — its own
               state, acknowledged on every surface — not
               stopped, which was a user's verb wearing the
               machine's event. */
            core.documentFinished(PlayerCore.Source.SYSTEM);
            return;
        }
        feedLocked(next);
    }

    public synchronized void onUtteranceError(int id) {
        if (!active || id != awaitingIdx) return;
        // Let the guard handle it immediately (one re-feed, then
        // the piece is declared lost if it fails again).
        deadlineMs = System.currentTimeMillis();
    }

    private void tick() {
        synchronized (this) {
            if (!active || awaitingIdx < 0) return;
            long now = System.currentTimeMillis();
            if (now >= deadlineMs) {
                int idx = awaitingIdx;
                if (!awaitingSpoke && attempts == 0 && chunks != null
                        && idx >= 0 && idx < chunks.size()) {
                    attempts = 1;
                    diagEvent("feed-retry", idx);
                    speakLocked(idx);
                } else {
                    awaitingIdx = -1;
                    diagEvent("feed-defect", idx);
                    if (defects != null) {
                        defects.onFeedDefect("A piece could not be read "
                                + "and was skipped.");
                    }
                    if (chunks != null && idx + 1 < chunks.size()) {
                        feedLocked(idx + 1);
                    } else {
                        // The lost piece was the book's last:
                        // the reading is over (the defect was
                        // surfaced above, in its own words).
                        haltLocked();
                        core.documentFinished(PlayerCore.Source.SYSTEM);
                    }
                }
            }
        }
        if (active) guardClock.schedule(guard, GUARD_TICK_MS);
    }

    private void feedLocked(int idx) {
        if (chunks == null || idx < 0 || idx >= chunks.size()) {
            haltLocked();
            return;
        }
        attempts = 0;
        awaitingSpoke = false;
        awaitingIdx = idx;
        speakLocked(idx);
        // Position truth at hand-off — the core's own doctrine.
        core.utteranceSpoke(idx, chunks.size());
    }

    private void speakLocked(int idx) {
        deadlineMs = System.currentTimeMillis() + START_WINDOW_MS;
        try {
            speaker.speak(idx, chunks.get(idx), rate, lang);
        } catch (Exception ignored) {
            // The guard declares it lost; never throw upward.
        }
        diagEvent("feed", idx);
    }

    private void diagEvent(String name, int idx) {
        if (diag == null) return;
        try {
            JSONObject d = new JSONObject();
            d.put("utterance", docId + "#" + idx);
            diag.event(name, d, System.currentTimeMillis());
        } catch (Exception ignored) {}
    }
}

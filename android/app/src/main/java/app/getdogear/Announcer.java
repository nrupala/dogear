package app.getdogear;

import android.os.Handler;

import org.json.JSONObject;

/**
 * Spoken announcements with completion accounting (redesign
 * FUNCTION; speaker.js's discipline ported native). An answer or
 * a failure line is a JOB of one or more pieces, spoken through
 * the same speech service the reading uses (utterance ids live in
 * a high range, clear of the feeder's chunk indexes). The
 * announcer counts, per job: given (pieces handed to the voice),
 * confirmed (pieces the voice reported finished after starting),
 * recovered (pieces that confirmed only after the guard's one
 * re-speak), lost (pieces that never confirmed). The ledger is
 * written to the diagnostics file at every job end — a mismatch
 * is a defect, never silence (the exercise's TALK leg reads this
 * ledger).
 *
 * The guard (the F-B5-2 lesson, kept): a piece the engine never
 * starts gets ONE re-speak, and a second failure marks the piece
 * lost, records the defect, and moves on — an announcement can
 * never hang the app the way a wedged utterance once could.
 */
public final class Announcer {

    public interface DefectSink {
        void onAnnouncementDefect(String what);
    }

    /** The spoken word, mirrored (Build H, D-8): every piece
     *  is reported as it is handed to the voice, and the job's
     *  end is reported with it — so a surface (the Listen deck)
     *  can carry in TEXT exactly what Talk is saying while it
     *  says it. Through Build G an announcement existed only
     *  as sound: on a muted phone, or to a user who cannot
     *  hear it, a Talk episode was twenty silent seconds. */
    public interface PieceSink {
        void onPiece(String tag, String text);
        void onJobFinished(String tag);
    }

    private static final long START_WINDOW_MS = 4000;
    private static final long GUARD_TICK_MS = 1000;
    private static final int ID_BASE = 1000000;

    private final IntSpeaker speaker;
    private final Handler handler;
    private final Diagnostics diag;
    private final DefectSink defects;
    private PieceSink pieceSink;
    /* Build H (L14(a) re-spec): a failure job's CLASS and the
       exact line it announced, carried into the ledger event.
       Through Build G every failure wrote one undifferentiated
       job="failure" — the product's own records could not say
       WHICH failure had spoken, so the leg that grades the
       permission class could not be graded at all. */
    private String jobClass;
    private String jobLine;

    private String[] pieces;
    private float rate = 1.0f;
    private String lang = "";
    private Runnable onComplete;
    private String jobTag = "";
    private int index;
    private int given, confirmed, recovered, lost;
    private boolean spokeCurrent;
    private int attempts;
    private long deadlineMs;
    private boolean running;
    private int jobSeq;

    private final Runnable guard = new Runnable() {
        @Override public void run() {
            tick();
        }
    };

    public Announcer(IntSpeaker speaker, Handler handler,
                     Diagnostics diag, DefectSink defects) {
        this.speaker = speaker;
        this.handler = handler;
        this.diag = diag;
        this.defects = defects;
    }

    public void setPieceSink(PieceSink sink) {
        pieceSink = sink;
    }

    public synchronized boolean busy() {
        return running;
    }

    /** Speak a job now, replacing whatever announcement was in
     *  flight (the service flushes per piece). onComplete runs on
     *  the main thread when every piece has confirmed or been
     *  declared lost — it ALWAYS runs, so callers can chain
     *  (e.g. resume reading) without a hang path. */
    public synchronized void announce(String tag, String[] jobPieces,
                                      float speechRate, String speechLang,
                                      Runnable complete) {
        announceClassed(tag, jobPieces, speechRate, speechLang,
                complete, null, null);
    }

    private synchronized void announceClassed(String tag, String[] jobPieces,
                                              float speechRate, String speechLang,
                                              Runnable complete,
                                              String failureClass,
                                              String failureLine) {
        cancelLocked();
        jobSeq++;
        jobClass = failureClass;
        jobLine = failureLine;
        jobTag = tag == null ? "" : tag;
        pieces = jobPieces;
        rate = speechRate;
        lang = speechLang == null ? "" : speechLang;
        onComplete = complete;
        index = 0;
        given = 0;
        confirmed = 0;
        recovered = 0;
        lost = 0;
        running = pieces != null && pieces.length > 0;
        if (!running) {
            finishLocked();
            return;
        }
        speakCurrentLocked();
        handler.removeCallbacks(guard);
        handler.postDelayed(guard, GUARD_TICK_MS);
    }

    /** One piece as a job — the failure-speech path. */
    public void say(String tag, String line, float speechRate,
                    String speechLang, Runnable complete) {
        announce(tag, new String[]{line}, speechRate, speechLang, complete);
    }

    /** A failure, spoken by class (Build H): the line comes
     *  from the FailureSpeech census by class, and the class
     *  + the line's identity ride into the announce-ledger
     *  event — the product's own record of WHICH failure
     *  spoke and WHAT it said (the L14(a) evidence seam). */
    public void sayFailure(String failureClass, float speechRate,
                           String speechLang, Runnable complete) {
        String line = FailureSpeech.lineFor(failureClass);
        announceClassed("failure", new String[]{line}, speechRate,
                speechLang, complete, failureClass, line);
    }

    public synchronized void cancel() {
        cancelLocked();
    }

    private void cancelLocked() {
        running = false;
        pieces = null;
        onComplete = null;
        jobClass = null;
        jobLine = null;
        handler.removeCallbacks(guard);
    }

    // ----------------------------------------------------------
    // Speech-service events (fanned out by MainActivity)
    // ----------------------------------------------------------

    public synchronized void onUtteranceStarted(int id) {
        if (!running || currentId() != id) return;
        spokeCurrent = true;
        deadlineMs = System.currentTimeMillis()
                + Math.max(60000L, (long) pieces[index].length() * 300L);
    }

    public synchronized void onUtteranceEnded(int id) {
        if (!running || currentId() != id) return;
        confirmed++;
        if (attempts > 0) recovered++;
        advanceLocked();
    }

    public synchronized void onUtteranceError(int id) {
        if (!running || currentId() != id) return;
        // An errored piece is handled by the guard path: treat it
        // as never-spoke so the one re-speak gets its chance now.
        deadlineMs = System.currentTimeMillis();
    }

    private void tick() {
        synchronized (this) {
            if (!running) return;
            long now = System.currentTimeMillis();
            if (now >= deadlineMs) {
                if (!spokeCurrent && attempts == 0) {
                    attempts = 1;
                    speakCurrentLocked();
                } else {
                    lost++;
                    if (defects != null) {
                        defects.onAnnouncementDefect(
                                "announcement piece lost: job=" + jobTag
                                        + " piece=" + index);
                    }
                    advanceLocked();
                }
            }
        }
        if (running) handler.postDelayed(guard, GUARD_TICK_MS);
    }

    private int currentId() {
        return ID_BASE + jobSeq * 1000 + index;
    }

    private void speakCurrentLocked() {
        spokeCurrent = false;
        given++;
        deadlineMs = System.currentTimeMillis() + START_WINDOW_MS;
        if (pieceSink != null) {
            pieceSink.onPiece(jobTag, pieces[index]);
        }
        try {
            speaker.speak(currentId(), pieces[index], rate, lang);
        } catch (Exception ignored) {
            // The guard will declare it lost; never throw upward.
        }
    }

    private void advanceLocked() {
        index++;
        attempts = 0;
        if (pieces == null || index >= pieces.length) {
            finishLocked();
            return;
        }
        speakCurrentLocked();
    }

    private void finishLocked() {
        running = false;
        handler.removeCallbacks(guard);
        if (diag != null) {
            try {
                JSONObject d = new JSONObject();
                d.put("job", jobTag);
                d.put("given", given);
                d.put("confirmed", confirmed);
                d.put("recovered", recovered);
                d.put("lost", lost);
                /* Build H: failure attribution — the class and
                   the announced line's identity, on failure jobs
                   only (answers carry neither). */
                if (jobClass != null) d.put("class", jobClass);
                if (jobLine != null) d.put("line", jobLine);
                diag.event("announce-ledger", d, System.currentTimeMillis());
            } catch (Exception ignored) {}
        }
        if (pieceSink != null) {
            pieceSink.onJobFinished(jobTag);
        }
        jobClass = null;
        jobLine = null;
        Runnable done = onComplete;
        onComplete = null;
        pieces = null;
        if (done != null) done.run();
    }
}

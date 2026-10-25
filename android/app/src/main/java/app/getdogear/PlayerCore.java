package app.getdogear;

import org.json.JSONObject;

/**
 * DogEar's ONE playback state machine (beta.5, app-first).
 *
 * Before beta.5, playback state lived in three places — the page's
 * reader, the bridge shim, and the speech service — and a press
 * acted on whichever machine it reached; when they disagreed the
 * press was silently absorbed (the owner's phone finding: Talk and
 * pause/stop "don't press properly while the app is speaking").
 * This class is the single source of truth those surfaces now
 * share:
 *
 *   - the NATIVE CONTROL BAR commands it (platform touch dispatch,
 *     painted by the UI thread — no press can starve behind the
 *     renderer's WASM work);
 *   - the MEDIA SESSION / notification commands it (same verbs);
 *   - the PAGE commands it through the bridge, and reflects its
 *     snapshots; the page's reader keeps chunking and highlighting
 *     (the pinned engine), but no longer owns the state;
 *   - the SPEECH SERVICE takes its orders from it and reports
 *     utterance lifecycle back into it.
 *
 * Commands are idempotent verbs (pause while paused is a no-op),
 * never toggles echoed between machines — the toggle-echo failure
 * of the old design is unrepresentable here.
 *
 * Ordering guarantee the old scaffolding could not make: Talk
 * capture starts only after the voice is stopped — silence before
 * the microphone opens, by construction.
 *
 * The core is Android-free: speech, capture, posting and the clock
 * are injected ports, so the transitions are covered by plain JVM
 * unit tests (PlayerCoreTest). All public entry points serialize
 * through the injected Poster (the main looper in production, a
 * direct runner in tests).
 */
public final class PlayerCore {

    /* FINISHED (Build I, Q-H4): a document that has been read
       to its end is a state of its own, not a flavour of
       stopped. Through Build H2 the book simply stopped —
       the deck kept a time-remaining claim and a bare Play
       (which replayed the final part), and no surface ever
       acknowledged the plain fact that the reading was done.
       The feeder raises FINISHED (documentFinished); it is
       left by playing (which re-opens the document at its
       start — doPlay), by a new session, or by removal. */
    public enum Playback { NONE, PLAYING, PAUSED, STOPPED, FINISHED }
    public enum Voice { IDLE, LISTENING, PROCESSING }
    public enum Source { PAGE, BAR, MEDIA, SYSTEM }

    /** The voice box. Implemented by SpeechService; absent when no
     *  service is running (commands then update state only — a
     *  pause for a voice that is not speaking is still the truth). */
    public interface SpeechPort {
        void pauseVoice();
        void resumeVoice();
        void stopVoice();
    }

    /** Native microphone capture. Implemented by VoiceCapture. */
    public interface CapturePort {
        interface Callback {
            void onCaptured(short[] samples, int sampleRate);
            /** errorClass: permission | busy | none | error — the
             *  classes the page's honest copy is keyed on. */
            void onCaptureError(String errorClass);
        }
        void start(Callback cb);
        void stop();
    }

    /** Pre-capture gate for Talk (Build F, U-6): a failure whose
     *  cause is knowable BEFORE capture — no voice model on the
     *  device is the standing case — must be spoken BEFORE the
     *  microphone opens, and capture must never start. talkStart
     *  silences playback first (as always), then asks the gate;
     *  only a proceed() opens the microphone. A blocked() verdict
     *  ends the Talk press through the normal audio-error path
     *  (the Announcer speaks the class's line, the resume
     *  discipline runs) exactly as if capture had failed —
     *  except no capture ever happened. When no gate is wired
     *  the press proceeds directly (the pre-F behavior). */
    public interface TalkGate {
        interface Callback {
            void proceed();
            void blocked(String failureClass);
        }
        void check(Callback cb);
    }

    public interface Poster {
        void post(Runnable r);
        /** Schedule on the same queue after a delay (Build G:
         *  the Talk gate's watchdog rides on this — the core
         *  never waits on an outside answer without its own
         *  clock running). */
        void postDelayed(Runnable r, long delayMs);
    }
    public interface Clock { long nowMs(); }

    /** Surfaces that reflect the machine: the activity (native bar
     *  + page forwarding + toasts) in production. */
    public interface Listener {
        void onSnapshot(JSONObject snapshot);
        void onPageEvent(JSONObject event);
        void onToast(String message);
        void onMicPermissionNeeded();
    }

    private final MarksStore store;
    private final CapturePort capture;
    private final Poster poster;
    private final Clock clock;

    private volatile SpeechPort speech;
    private volatile Listener listener;
    private volatile TalkGate talkGate;
    /** Generation of the current Talk press: a gate verdict
     *  from an older press (or one the user cancelled with
     *  talkStop while the gate was still deciding) is ignored. */
    private int talkSeq = 0;
    private boolean talkGatePending = false;
    /** Build G (D-5): the core's own backstop for a gate
     *  verdict that never arrives — deliberately longer than
     *  the host gate's own 2.5 s probe fallback, so a healthy
     *  host resolves first and this fires only when the host
     *  path itself has failed. */
    static final long TALK_GATE_TIMEOUT_MS = 4000;

    private Playback playback = Playback.NONE;
    private Voice voice = Voice.IDLE;
    private String docId = null;
    private String title = "";
    private int chunk = -1;
    private int chunks = 0;
    /** Set when THIS machine silenced playback for a capture begun
     *  from a native surface: the page's post-capture flow decides
     *  resumption (a voice command may itself be "stop"). */
    private boolean captureSilencedPlayback = false;

    public PlayerCore(MarksStore store, CapturePort capture, Poster poster, Clock clock) {
        this.store = store;
        this.capture = capture;
        this.poster = poster;
        this.clock = clock;
    }

    public void attachSpeech(SpeechPort port) { this.speech = port; }
    public void detachSpeech(SpeechPort port) {
        if (this.speech == port) this.speech = null;
    }
    public void setListener(Listener l) { this.listener = l; }
    public void setTalkGate(TalkGate gate) { this.talkGate = gate; }

    // ------------------------------------------------------------------
    // Session + utterance lifecycle (reported by the bridge/service)
    // ------------------------------------------------------------------

    public void sessionStarted(final String newDocId, final String newTitle,
                               final int seedChunk, final int seedChunks) {
        startSession(newDocId, newTitle, seedChunk, seedChunks,
                Playback.STOPPED, false);
    }

    /** A place JUMP inside the open document (Build I,
     *  defect D-17, correcting the D-9 rule). A jump re-seeds
     *  the session at the target — and a re-seed's rest state
     *  is STOPPED by the D-2 law, which silently DROPPED a
     *  paused session to stopped: the place moved, but the
     *  state the user was in did not survive the move (the
     *  USER seat read the changed word and had to check what
     *  it meant; the TESTER seat's L21 case 2 failed it
     *  twice). Preservation means all three states, exactly:
     *  the host passes holdPaused when the pre-jump state was
     *  PAUSED, and the re-seed lands PAUSED at the target,
     *  in the same queue unit — no window where the machine
     *  wears the wrong state. A jump while playing needs no
     *  rest state at all: the host re-feeds and
     *  utteranceSpoke raises PLAYING at the target. The
     *  jumped place is also persisted as the live position,
     *  so every surface's "your place" and any later resume
     *  agree with where the jump landed. */
    public void jumpSession(final String jumpDocId, final String jumpTitle,
                            final int targetChunk, final int totalChunks,
                            final boolean holdPaused) {
        startSession(jumpDocId, jumpTitle, targetChunk, totalChunks,
                holdPaused ? Playback.PAUSED : Playback.STOPPED, true);
    }

    private void startSession(final String newDocId, final String newTitle,
                              final int seedChunk, final int seedChunks,
                              final Playback restState,
                              final boolean persistPlace) {
        poster.post(new Runnable() { @Override public void run() {
            docId = newDocId;
            title = newTitle == null ? "" : newTitle;
            chunks = seedChunks;
            chunk = seedChunk;
            // EXERCISE D-2 (2026-10-24): a new session is NOT
            // playing until the feeder speaks its first chunk
            // (utteranceSpoke raises PLAYING). The page-era code
            // left the previous session's PLAYING in place across
            // the swap, so the host's play() no-opped ("already
            // playing") and the new document never fed — the bar
            // claimed playing over silence, forever. Playback truth
            // restarts with the session.
            playback = restState;
            voice = Voice.IDLE;
            JSONObject saved = store.positionFor(docId);
            if (saved != null) {
                if (chunk < 0) chunk = saved.optInt("chunk", -1);
                if (chunks <= 0) chunks = saved.optInt("chunks", 0);
            }
            if (persistPlace && docId != null && chunk >= 0) {
                store.savePosition(docId, title, chunk, chunks,
                        false, clock.nowMs());
            }
            emitSnapshot();
        }});
    }

    public void sessionEnded() {
        poster.post(new Runnable() { @Override public void run() {
            docId = null;
            title = "";
            chunk = -1;
            chunks = 0;
            if (playback == Playback.PLAYING || playback == Playback.PAUSED
                    || playback == Playback.FINISHED) {
                playback = Playback.STOPPED;
            }
            emitSnapshot();
        }});
    }

    /** Session end for a document that is being REMOVED. The
     *  purge runs INSIDE the posted runnable, behind every save
     *  already queued (stop() persists the place \u2014 "keep my
     *  place" \u2014 and utteranceSpoke saves on every chunk): a
     *  host that purges from its own thread races those queued
     *  saves, and the save resurrects the removed document's
     *  place (EXERCISE D-3, 2026-10-25: removing the open,
     *  playing document left its position in the marks store
     *  after the confirm dialog had promised it gone). The FIFO
     *  poster makes the ordering exact: every save queued before
     *  the forget lands first, the purge lands last. */
    public void sessionEndedForget(final String forgetDocId) {
        poster.post(new Runnable() { @Override public void run() {
            String ended = forgetDocId != null ? forgetDocId : docId;
            docId = null;
            title = "";
            chunk = -1;
            chunks = 0;
            if (playback == Playback.PLAYING || playback == Playback.PAUSED
                    || playback == Playback.FINISHED) {
                playback = Playback.STOPPED;
            }
            if (ended != null) store.deleteDocument(ended);
            emitSnapshot();
        }});
    }

    /** The open document has been read to its end (Build I,
     *  Q-H4). Raised by the feeder at the book's natural end
     *  — never by a user press: Stop stays Stop, and a book
     *  the user stopped mid-way never wears Finished. The
     *  place persists (the end IS the place now), and the
     *  surfaces take the acknowledgment from the snapshot:
     *  the deck and strip read "Finished", and Play from
     *  here is labelled — and acts — as reading again from
     *  the start (doPlay's FINISHED branch). */
    public void documentFinished(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (docId == null || playback != Playback.PLAYING) return;
            playback = Playback.FINISHED;
            persistPlace(false);
            emitSnapshot();
        }});
    }

    public void sessionTitle(final String newTitle) {
        poster.post(new Runnable() { @Override public void run() {
            if (newTitle != null && !newTitle.isEmpty()) title = newTitle;
            emitSnapshot();
        }});
    }

    /** A chunk was handed to the voice. This is the position truth:
     *  the place persists on EVERY chunk start, so Continue is
     *  exact even if the app dies mid-sentence. */
    public void utteranceSpoke(final int chunkIndex, final int chunkTotal) {
        poster.post(new Runnable() { @Override public void run() {
            if (chunkIndex >= 0) chunk = chunkIndex;
            if (chunkTotal > 0) chunks = chunkTotal;
            if (playback != Playback.PLAYING) playback = Playback.PLAYING;
            if (docId != null && chunk >= 0) {
                store.savePosition(docId, title, chunk, chunks, false, clock.nowMs());
            }
            emitSnapshot();
        }});
    }

    // ------------------------------------------------------------------
    // Transport commands (idempotent verbs)
    // ------------------------------------------------------------------

    public void pause(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            doPause(source);
        }});
    }

    private void doPause(Source source) {
        if (playback != Playback.PLAYING) return;
        SpeechPort s = speech;
        if (s != null) s.pauseVoice();
        playback = Playback.PAUSED;
        if (source != Source.PAGE) emitControl("pause");
        emitSnapshot();
    }

    public void resume(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            doResume(source);
        }});
    }

    private void doResume(Source source) {
        if (playback != Playback.PAUSED) return;
        SpeechPort s = speech;
        if (s != null) s.resumeVoice();
        playback = Playback.PLAYING;
        if (source != Source.PAGE) emitControl("resume");
        emitSnapshot();
    }

    /** The transport press (Build F, U-1). Surfaces used to
     *  decide pause-vs-resume from their own CACHED rendering of
     *  the state and call the matching verb — a press issued
     *  against a stale render called a verb that no-ops silently
     *  (resume while playing returns before any snapshot is
     *  emitted), so the press vanished and no surface said so:
     *  the USER seat's "pause did not hold". The toggle decides
     *  HERE, inside the serialized queue, from the machine's own
     *  current truth at the moment the press is processed —
     *  playing pauses, paused resumes, stopped plays. No surface
     *  cache can absorb a press again. */
    public void togglePlayPause(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (playback == Playback.PLAYING) doPause(source);
            else if (playback == Playback.PAUSED) doResume(source);
            else doPlay(source);
        }});
    }

    public void stop(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (playback == Playback.STOPPED || playback == Playback.NONE
                    || playback == Playback.FINISHED) {
                // Still persist the place: Stop means "keep my place".
                // FINISHED stands (Build I): nothing is sounding,
                // and the end the feeder acknowledged is not
                // un-happened by a press with nothing to stop.
                persistPlace(false);
                return;
            }
            SpeechPort s = speech;
            if (s != null) s.stopVoice();
            playback = Playback.STOPPED;
            persistPlace(false);
            if (source != Source.PAGE) emitControl("stop");
            emitSnapshot();
        }});
    }

    /** Play / Continue from a standing start. With a live session
     *  the page's reader is commanded (it owns chunk order); with
     *  no session, the best saved place is offered to the page as a
     *  continue event (open + seek + play). */
    public void play(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            doPlay(source);
        }});
    }

    private void doPlay(Source source) {
            if (playback == Playback.PLAYING) return;
            if (playback == Playback.PAUSED) {
                doResume(source);
                return;
            }
            if (playback == Playback.FINISHED && docId != null) {
                /* Build I (Q-H4): Play from Finished is "read
                   again from the start" — the surfaces label it
                   so, and the act must match the label. The host
                   re-opens the document at chunk 0 and plays,
                   exactly the continue shape with the target
                   pinned to the first part. (Through Build H2,
                   Play here emitted the bare play control and
                   the feeder replayed the FINAL part — the one
                   part nobody pressing it meant.) */
                try {
                    JSONObject ev = new JSONObject();
                    ev.put("t", "continue");
                    ev.put("docId", docId);
                    ev.put("chunk", 0);
                    ev.put("chunks", chunks);
                    ev.put("pinned", false);
                    ev.put("title", title);
                    emitPageEvent(ev);
                } catch (Exception ignored) {}
                emitSnapshot();
                return;
            }
            if (docId != null) {
                emitControl("play");
            } else {
                JSONObject target = store.continueTarget(null);
                if (target != null) {
                    try {
                        JSONObject ev = new JSONObject();
                        ev.put("t", "continue");
                        ev.put("docId", target.optString("docId", ""));
                        ev.put("chunk", target.optInt("chunk", 0));
                        ev.put("chunks", target.optInt("chunks", 0));
                        ev.put("pinned", target.optBoolean("pinned", false));
                        ev.put("title", target.optString("title", ""));
                        emitPageEvent(ev);
                    } catch (Exception ignored) {}
                } else {
                    toast("Nothing saved to continue yet.");
                }
            }
            emitSnapshot();
    }

    public void next(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            emitControl("next");
        }});
    }

    public void prev(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            emitControl("prev");
        }});
    }

    // ------------------------------------------------------------------
    // The eight in-playback features
    // ------------------------------------------------------------------

    /** Save: pin the current place as the explicit Continue point. */
    public void savePlace(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (docId == null) { toast("Open a document first."); return; }
            persistPlace(true);
            toast("Place saved — part " + (chunk + 1) + " of " + chunks + ".");
            emitSnapshot();
        }});
    }

    /** Continue: resume exactly at the saved place — the open
     *  document's explicit save first, then its live place, then
     *  the most recent document overall (MarksStore's order). */
    public void continueSaved(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            JSONObject target = store.continueTarget(docId);
            if (target == null) { toast("Nothing saved to continue yet."); return; }
            try {
                JSONObject ev = new JSONObject();
                ev.put("t", "continue");
                ev.put("docId", target.optString("docId", ""));
                ev.put("chunk", target.optInt("chunk", 0));
                ev.put("chunks", target.optInt("chunks", 0));
                ev.put("pinned", target.optBoolean("pinned", false));
                ev.put("title", target.optString("title", ""));
                emitPageEvent(ev);
            } catch (Exception ignored) {}
            emitSnapshot();
        }});
    }

    public void toggleFavorite(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (docId == null) { toast("Open a document first."); return; }
            boolean now = store.toggleFavorite(docId);
            toast(now ? "Added to favorites." : "Removed from favorites.");
            emitMarksChanged();
            emitSnapshot();
        }});
    }

    public void addBookmark(final String label, final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (docId == null) { toast("Open a document first."); return; }
            store.addBookmark(docId, Math.max(chunk, 0),
                    label == null || label.trim().isEmpty()
                            ? "Part " + (chunk + 1) : label, clock.nowMs());
            toast("Bookmark saved at part " + (chunk + 1) + ".");
            emitMarksChanged();
            emitSnapshot();
        }});
    }

    public void addTag(final String tag, final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (docId == null) { toast("Open a document first."); return; }
            if (tag == null || tag.trim().isEmpty()) return;
            store.addTag(docId, Math.max(chunk, 0), tag, clock.nowMs());
            toast("Tagged \u201C" + tag.trim() + "\u201D.");
            emitMarksChanged();
            emitSnapshot();
        }});
    }

    public void addNote(final String text, final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (docId == null) { toast("Open a document first."); return; }
            if (text == null || text.trim().isEmpty()) return;
            store.addNote(docId, Math.max(chunk, 0), text, clock.nowMs());
            toast("Note saved at part " + (chunk + 1) + ".");
            emitMarksChanged();
            emitSnapshot();
        }});
    }

    // ------------------------------------------------------------------
    // Talk (native capture)
    // ------------------------------------------------------------------

    /** Begin listening. The ordering IS the feature: if the app is
     *  speaking, the voice is stopped FIRST and the microphone
     *  opens only into that silence — the beta.4 defect (capture
     *  racing live TTS through a page-side pause chain) cannot
     *  occur. The page's reader is deliberately NOT toggled from
     *  here: its held chunk is the resume point, and resumption is
     *  decided by the page after the heard intent is known (a
     *  command may itself be "stop"). */
    public void talkStart(final Source source) {
        poster.post(new Runnable() { @Override public void run() {
            if (voice != Voice.IDLE || talkGatePending) return;
            if (docId == null) { toast("Open a document first, then Talk."); return; }
            captureSilencedPlayback = false;
            if (playback == Playback.PLAYING) {
                SpeechPort s = speech;
                if (s != null) s.pauseVoice();
                playback = Playback.PAUSED;
                captureSilencedPlayback = true;
                // Park the page's reader too, so its held chunk is
                // a clean resume point and its post-capture flow
                // (answer, then resume) works exactly as it does
                // for a page-started Talk. A page-started Talk has
                // already parked the reader before calling in —
                // then playback reads PAUSED here and this branch
                // never runs.
                emitControl("pause");
            }
            // Build F (U-6): the gate decides BEFORE the
            // microphone opens. Playback is already silenced —
            // the ordering law (silence before the mic) is
            // unchanged; what is new is that a cause knowable
            // now (no voice model installed) is spoken now, and
            // capture never starts for it.
            final int seq = ++talkSeq;
            TalkGate gate = talkGate;
            if (gate == null) {
                beginCapture();
                return;
            }
            talkGatePending = true;
            emitSnapshot();
            /* Build G (defect D-5): the press must never wait
               on the gate without the core's own clock running.
               On the Build F bench a Talk press was observed
               silenced and never resolved — no verdict, no
               capture, no spoken reason, for as long as the
               process was watched (the host-side probe and its
               own 2.5 s fallback both failed to land that one
               time, under heavy host load; four faithful
               re-drives resolved correctly). Whatever the host
               cause, the class is closed here: the watchdog is
               armed BEFORE the gate is asked, a throwing gate
               resolves as a proceed, and a silent gate resolves
               as a proceed when the watchdog fires — the press
               falls back to the post-capture path, whose
               classes all speak honestly, instead of hanging. */
            poster.postDelayed(new Runnable() { @Override public void run() {
                if (seq != talkSeq || !talkGatePending) return;
                talkGatePending = false;
                beginCapture();
            }}, TALK_GATE_TIMEOUT_MS);
            TalkGate.Callback verdict = new TalkGate.Callback() {
                @Override public void proceed() {
                    poster.post(new Runnable() { @Override public void run() {
                        if (seq != talkSeq || !talkGatePending) return;
                        talkGatePending = false;
                        beginCapture();
                    }});
                }
                @Override public void blocked(final String failureClass) {
                    poster.post(new Runnable() { @Override public void run() {
                        if (seq != talkSeq || !talkGatePending) return;
                        talkGatePending = false;
                        boolean resumeAfter = captureSilencedPlayback;
                        captureSilencedPlayback = false;
                        emitAudioError(failureClass == null
                                ? "engine-generic" : failureClass,
                                resumeAfter);
                        emitSnapshot();
                    }});
                }
            };
            try {
                gate.check(verdict);
            } catch (Throwable gateFailure) {
                // A gate that throws has given no verdict; the
                // press proceeds (the post-capture path speaks
                // its own classes honestly).
                verdict.proceed();
            }
        }});
    }

    /** Open the microphone (the gate has proceeded, or none is
     *  wired). The voice state rises exactly here — never
     *  before the gate's word — so a surface showing "listening"
     *  is proof capture actually began. */
    private void beginCapture() {
        voice = Voice.LISTENING;
        emitSnapshot();
        capture.start(new CapturePort.Callback() {
            @Override public void onCaptured(short[] samples, int sampleRate) {
                onCaptureDone(samples, sampleRate, null);
            }
            @Override public void onCaptureError(String errorClass) {
                onCaptureDone(null, 0, errorClass);
            }
        });
    }

    public void talkStop() {
        poster.post(new Runnable() { @Override public void run() {
            if (talkGatePending) {
                // The press is cancelled while the gate is still
                // deciding: the gate's verdict, when it lands,
                // is stale and ignored, capture never opens, and
                // playback this press silenced is given back.
                talkGatePending = false;
                talkSeq++;
                if (captureSilencedPlayback) {
                    captureSilencedPlayback = false;
                    doResume(Source.SYSTEM);
                }
                emitSnapshot();
                return;
            }
            if (voice == Voice.LISTENING) capture.stop();
        }});
    }

    /** The activity asked for the mic permission (after a
     *  "permission-needed" capture result) and the user refused:
     *  NOW the blocked class is the truth — tell the page. */
    public void capturePermissionDenied() {
        poster.post(new Runnable() { @Override public void run() {
            emitAudioError("permission", false);
            emitSnapshot();
        }});
    }

    private void emitAudioError(String errorClass, boolean resumeAfter) {
        try {
            JSONObject ev = new JSONObject();
            ev.put("t", "audioError");
            ev.put("class", errorClass);
            ev.put("resumeAfter", resumeAfter);
            emitPageEvent(ev);
        } catch (Exception ignored) {}
    }

    private void onCaptureDone(final short[] samples, final int sampleRate,
                               final String errorClass) {
        poster.post(new Runnable() { @Override public void run() {
            if (voice == Voice.IDLE) return;
            boolean resumeAfter = captureSilencedPlayback;
            captureSilencedPlayback = false;
            if (errorClass != null) {
                voice = Voice.IDLE;
                if ("permission-needed".equals(errorClass)) {
                    // The OS permission was never granted: this is
                    // a prompt, not a failure. The activity asks;
                    // on grant it retries talkStart, on denial it
                    // calls capturePermissionDenied() and only then
                    // does the page hear the blocked class.
                    Listener l = listener;
                    if (l != null) l.onMicPermissionNeeded();
                    else emitAudioError("permission", resumeAfter);
                    emitSnapshot();
                    return;
                }
                emitAudioError(errorClass, resumeAfter);
                emitSnapshot();
                return;
            }
            voice = Voice.PROCESSING;
            emitSnapshot();
            try {
                // PCM16 little-endian, base64 — the page decodes to
                // the Float32 samples its (unchanged) engine eats.
                byte[] bytes = new byte[samples.length * 2];
                for (int i = 0; i < samples.length; i++) {
                    bytes[i * 2] = (byte) (samples[i] & 0xff);
                    bytes[i * 2 + 1] = (byte) ((samples[i] >> 8) & 0xff);
                }
                JSONObject ev = new JSONObject();
                ev.put("t", "audio");
                ev.put("b64", encodeBase64(bytes));
                ev.put("sampleRate", sampleRate);
                ev.put("resumeAfter", resumeAfter);
                emitPageEvent(ev);
            } catch (Exception ignored) {}
            voice = Voice.IDLE;
            emitSnapshot();
        }});
    }

    // ------------------------------------------------------------------
    // Audio focus (reported by the service)
    // ------------------------------------------------------------------

    /** Permanent focus loss behaves exactly like a media pause:
     *  voice stops and the page is told, so every surface agrees. */
    public void focusLost() {
        pause(Source.SYSTEM);
    }

    // ------------------------------------------------------------------
    // Snapshots + events
    // ------------------------------------------------------------------

    public JSONObject snapshot() {
        JSONObject s = new JSONObject();
        try {
            s.put("t", "state");
            s.put("playback", playback.name().toLowerCase(java.util.Locale.US));
            s.put("voice", voice.name().toLowerCase(java.util.Locale.US));
            s.put("docId", docId == null ? JSONObject.NULL : docId);
            s.put("title", title);
            s.put("chunk", chunk);
            s.put("chunks", chunks);
            s.put("favorite", docId != null && store.isFavorite(docId));
            s.put("canContinue", store.hasAnyPosition());
            JSONObject saved = docId == null ? null : store.savedFor(docId);
            if (saved == null && docId != null) saved = store.positionFor(docId);
            s.put("savedChunk", saved == null ? -1 : saved.optInt("chunk", -1));
            /* Build H (D-7): the DELIBERATE pin, named apart
               from the live position. Through Build G the
               surfaces could not tell a saved place from the
               automatic position (savedChunk above falls back
               to it), so the deck said "place saved" over a
               place nobody saved, and a standing Continue stood
               beside Resume with nothing to tell them apart.
               pinChunk is the pin or -1; surfaces word the two
               places differently ("Saved place" / "your place")
               and show Continue only against a real pin. */
            JSONObject pin = docId == null ? null : store.savedFor(docId);
            s.put("pinChunk", pin == null ? -1 : pin.optInt("chunk", -1));
            /* Build H (D-8): the Talk gate's pending state is
               snapshot truth, so the deck can SAY what Talk is
               doing during the seconds the gate decides —
               through Build G those seconds were invisible on
               every surface. */
            s.put("talkGate", talkGatePending ? "checking" : "idle");
        } catch (Exception ignored) {}
        return s;
    }

    /** Marks for the page to render (bridge pull). */
    public JSONObject marksFor(String forDocId) {
        return store.marksFor(forDocId);
    }

    private void persistPlace(boolean explicit) {
        if (docId == null || chunk < 0) return;
        store.savePosition(docId, title, chunk, chunks, explicit, clock.nowMs());
    }

    private void emitSnapshot() {
        Listener l = listener;
        if (l == null) return;
        JSONObject s = snapshot();
        l.onSnapshot(s);
        l.onPageEvent(s);
    }

    private void emitControl(String action) {
        try {
            JSONObject ev = new JSONObject();
            ev.put("t", "control");
            ev.put("action", action);
            emitPageEvent(ev);
        } catch (Exception ignored) {}
    }

    private void emitMarksChanged() {
        try {
            JSONObject ev = new JSONObject();
            ev.put("t", "marks");
            ev.put("docId", docId == null ? "" : docId);
            emitPageEvent(ev);
        } catch (Exception ignored) {}
    }

    private void emitPageEvent(JSONObject ev) {
        Listener l = listener;
        if (l != null) l.onPageEvent(ev);
    }

    private void toast(String msg) {
        Listener l = listener;
        if (l != null) l.onToast(msg);
    }

    /** RFC 4648 base64, no wrapping — kept in-class so the core
     *  stays Android-free and JVM-testable (the page decodes). */
    private static String encodeBase64(byte[] data) {
        final char[] ALPH = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".toCharArray();
        StringBuilder out = new StringBuilder(((data.length + 2) / 3) * 4);
        for (int i = 0; i < data.length; i += 3) {
            int b0 = data[i] & 0xff;
            int b1 = i + 1 < data.length ? data[i + 1] & 0xff : 0;
            int b2 = i + 2 < data.length ? data[i + 2] & 0xff : 0;
            out.append(ALPH[b0 >> 2]);
            out.append(ALPH[((b0 & 0x3) << 4) | (b1 >> 4)]);
            out.append(i + 1 < data.length ? ALPH[((b1 & 0xf) << 2) | (b2 >> 6)] : '=');
            out.append(i + 2 < data.length ? ALPH[b2 & 0x3f] : '=');
        }
        return out.toString();
    }

    // Test-visible state (package-private).
    Playback playback() { return playback; }
    Voice voice() { return voice; }
    int chunk() { return chunk; }
}

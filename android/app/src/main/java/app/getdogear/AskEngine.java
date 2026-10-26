package app.getdogear;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * The Talk router, native (redesign FUNCTION). A finished
 * transcription is routed exactly the way the proven web loop
 * routed it:
 *   1. voice commands (the pinned grammar, ported below),
 *   2. questions about the app itself (SelfModel),
 *   3. questions about the open document — answered by QUOTING
 *      it (lexical retrieval over the native chunks), never by
 *      composing; when the document does not answer, the refusal
 *      says so and says why,
 *   4. anything else → the unknown line (FailureSpeech), spoken.
 * Every failure exit speaks its class line to completion through
 * the Announcer (the R3 law), and every path ends with the
 * resume discipline the core recorded: reading resumes at the
 * held chunk unless the command itself was stop/pause.
 *
 * Intent grammar: a faithful port of voicepack.js parseIntent —
 * same normalization, same command table, same question shape —
 * so the two endpoints hear the same commands the same way.
 */
public final class AskEngine implements EngineHost.Listener {

    private final PlayerCore core;
    private final DocumentStore docs;
    private final Announcer announcer;
    private final EngineHost engine;
    private final Licence licence;
    private final Diagnostics diag;

    /** Position steering the core has no verb for (back /
     *  forward / start over): the host re-seeds the session at
     *  the target chunk and, when asked, restarts feeding there. */
    public interface Steering {
        void steerTo(int chunk, boolean playAfter);
    }

    private float rate = 1.0f;
    private String lang = "";
    private boolean pendingResume;
    private Steering steering;
    /** Runs when an announcement (answer or failure line) has
     *  spoken to completion and reading should resume: the host
     *  re-feeds the held document chunk (flushing the
     *  announcement's last piece from the service) — deliberately
     *  NOT core.resume(), whose service re-speak would replay the
     *  announcement piece. */
    private Runnable announcementResumeHook;

    public void setSteering(Steering s) {
        steering = s;
    }

    public void setAnnouncementResumeHook(Runnable hook) {
        announcementResumeHook = hook;
    }

    private static final String[][] COMMANDS = {
            {"startover", "^(start over|start again|from the top|from the beginning|restart|back to the start|back to the beginning)$"},
            {"stop", "^(stop|stop reading|stop it|stop playback|enough|be quiet|quiet)$"},
            {"pause", "^(pause|pause it|pause reading|hold on|wait|wait a moment|wait a second)$"},
            {"resume", "^(resume|resume reading|continue|continue reading|keep reading|carry on|go on)$"},
            {"play", "^(listen|play|read|read it|read aloud|start|start reading|begin|begin reading)$"},
            {"back", "^(back|go back|back up|rewind|go back a bit|back a little|previous bit)$"},
            {"forward", "^(forward|go forward|skip|skip ahead|skip forward|jump ahead|go forward a bit|next bit)$"},
    };
    private static final Pattern[] COMMAND_PATTERNS = compileCommands();
    private static final Pattern QUESTION_START = Pattern.compile(
            "^(what|who|whom|whose|when|where|why|how|which|is|are|was|were|do|does|did|can|could|should|would|tell me|name|list|describe|explain)\\b");

    private static Pattern[] compileCommands() {
        Pattern[] out = new Pattern[COMMANDS.length];
        for (int i = 0; i < COMMANDS.length; i++) {
            out[i] = Pattern.compile(COMMANDS[i][1]);
        }
        return out;
    }

    public AskEngine(PlayerCore core, DocumentStore docs, Announcer announcer,
                     EngineHost engine, Licence licence, Diagnostics diag) {
        this.core = core;
        this.docs = docs;
        this.announcer = announcer;
        this.engine = engine;
        this.licence = licence;
        this.diag = diag;
    }

    public void setSpeechParams(float speechRate, String speechLang) {
        rate = speechRate;
        lang = speechLang == null ? "" : speechLang;
    }

    // ----------------------------------------------------------
    // Entry points (MainActivity fans the core's events here)
    // ----------------------------------------------------------

    /** Captured audio arrived (the core silenced playback first —
     *  the silence-before-mic ordering is the core's, kept). */
    public void onAudio(String wavBase64, boolean resumeAfter) {
        pendingResume = resumeAfter;
        if (engine == null || !engine.isReady()) {
            fail(FailureSpeech.ENGINE_GENERIC);
            return;
        }
        engine.transcribe(wavBase64);
    }

    /** Capture itself failed before any audio existed: speak the
     *  class line (R3: never silent), then the resume discipline. */
    public void onAudioError(String captureClass, boolean resumeAfter) {
        pendingResume = resumeAfter;
        fail(captureClass == null ? FailureSpeech.CAPTURE_ERROR : captureClass);
    }

    @Override
    public void onEngineEvent(JSONObject event) {
        if (!"transcript".equals(event.optString("kind", ""))) return;
        if (!event.optBoolean("ok", false)) {
            fail(event.optString("cls", FailureSpeech.ENGINE_GENERIC));
            return;
        }
        transcriptionProven = true;
        String text = event.optString("text", "").trim();
        if (text.isEmpty()) {
            fail(FailureSpeech.NO_SPEECH);
            return;
        }
        handleHeard(text);
    }

    // ----------------------------------------------------------
    // Routing
    // ----------------------------------------------------------

    private void handleHeard(String rawText) {
        String t = normalize(rawText);
        diagEvent("heard", rawText);
        if (t.isEmpty()) {
            fail(FailureSpeech.NO_SPEECH);
            return;
        }
        // "ask: <question>" escape, as in the pinned grammar.
        if (t.startsWith("ask:") || t.startsWith("ask ")) {
            String q = t.substring(4).trim();
            if (!q.isEmpty()) {
                routeQuestion(q, rawText);
                return;
            }
        }
        for (int i = 0; i < COMMANDS.length; i++) {
            if (COMMAND_PATTERNS[i].matcher(t).find()) {
                runCommand(COMMANDS[i][0]);
                return;
            }
        }
        String topic = SelfModel.match(rawText);
        if (topic != null) {
            SelfModel.Ctx ctx = new SelfModel.Ctx();
            ctx.unlocked = licence != null && licence.isUnlocked();
            ctx.modelInstalled = modelInstalledGuess();
            speakAnswer("self", SelfModel.answerFor(topic, ctx));
            return;
        }
        if (QUESTION_START.matcher(t).find() || rawText.contains("?")
                || t.split("\\s+").length >= 3) {
            routeQuestion(t, rawText);
            return;
        }
        fail(FailureSpeech.UNKNOWN);
    }

    private void runCommand(String action) {
        boolean resume = pendingResume;
        pendingResume = false;
        if ("stop".equals(action)) {
            core.stop(PlayerCore.Source.SYSTEM);
        } else if ("pause".equals(action)) {
            // Talk already silenced playback; a spoken "pause"
            // simply keeps it held (the resume discipline is
            // cancelled above).
            core.pause(PlayerCore.Source.SYSTEM);
        } else if ("resume".equals(action) || "play".equals(action)) {
            // Nothing was announced, so the service still holds
            // the document chunk: the core's own resume is the
            // truthful path (it re-speaks the held chunk).
            core.resume(PlayerCore.Source.SYSTEM);
        } else if ("back".equals(action) || "forward".equals(action)
                || "startover".equals(action)) {
            if (steering == null) {
                fail(FailureSpeech.UNKNOWN);
                return;
            }
            JSONObject snap = core.snapshot();
            int chunk = snap.optInt("chunk", 0);
            int total = snap.optInt("chunks", 0);
            int target = "startover".equals(action) ? 0
                    : chunk + ("back".equals(action) ? -1 : 1);
            target = Math.max(0, Math.min(target, Math.max(0, total - 1)));
            steering.steerTo(target, resume);
        } else {
            fail(FailureSpeech.UNKNOWN);
        }
    }

    private void routeQuestion(String normalized, String rawText) {
        JSONObject snap = core.snapshot();
        String docId = snap.optString("docId", "");
        if (docId.isEmpty()) {
            fail(FailureSpeech.NO_DOCUMENT);
            return;
        }
        List<String> chunks = docs.chunksOf(docId);
        if (chunks.isEmpty()) {
            fail(FailureSpeech.NO_DOCUMENT);
            return;
        }
        int best = bestChunk(normalized, chunks);
        if (best < 0) {
            speakAnswer("refusal",
                    "The document doesn\u2019t answer that. I searched its "
                            + chunks.size() + " parts for your words and none "
                            + "of them speak to it \u2014 try asking about "
                            + "something the document covers, or ask me what "
                            + "it is about.");
            return;
        }
        String answer = "Here is what the document says. "
                + chunks.get(best)
                + " That was part " + (best + 1) + " of " + chunks.size() + ".";
        speakAnswer("document", answer);
    }

    /** Lexical retrieval: the chunk sharing the most question
     *  terms wins; ties go to the earliest. Returns -1 when no
     *  chunk shares a single content term — the honest refusal. */
    static int bestChunk(String question, List<String> chunks) {
        Set<String> terms = contentTerms(question);
        if (terms.isEmpty()) return -1;
        int bestIdx = -1;
        int bestScore = 0;
        for (int i = 0; i < chunks.size(); i++) {
            String[] words = chunks.get(i).toLowerCase()
                    .split("[^a-z0-9']+");
            int score = 0;
            Set<String> seen = new HashSet<String>();
            for (String w : words) {
                if (terms.contains(w) && seen.add(w)) score++;
            }
            if (score > bestScore) {
                bestScore = score;
                bestIdx = i;
            }
        }
        return bestScore > 0 ? bestIdx : -1;
    }

    private static final Set<String> STOPWORDS = new HashSet<String>();
    static {
        String[] sw = {"what", "does", "did", "the", "a", "an", "is", "are",
                "was", "were", "do", "say", "says", "about", "of", "in",
                "on", "to", "and", "or", "for", "how", "why", "when",
                "where", "who", "which", "can", "could", "would", "should",
                "tell", "me", "it", "this", "that", "there", "any"};
        for (String w : sw) STOPWORDS.add(w);
    }

    static Set<String> contentTerms(String text) {
        Set<String> out = new HashSet<String>();
        for (String w : text.toLowerCase().split("[^a-z0-9']+")) {
            if (w.length() >= 3 && !STOPWORDS.contains(w)) out.add(w);
        }
        return out;
    }

    private boolean transcriptionProven;

    private boolean modelInstalledGuess() {
        // Truth seam: for the spoken self-model, "a model is
        // installed" is claimed only once transcription has
        // actually worked this session — the strongest evidence
        // available to this class, and never an assumption. The
        // Settings shelf carries the engine's own per-model
        // status for the standing record.
        return transcriptionProven;
    }

    // ----------------------------------------------------------
    // Speaking + the resume discipline
    // ----------------------------------------------------------

    private void speakAnswer(String tag, String answer) {
        final boolean resume = pendingResume;
        pendingResume = false;
        announcer.announce(tag, piecesOf(answer), rate, lang, new Runnable() {
            @Override public void run() {
                if (resume && announcementResumeHook != null) {
                    announcementResumeHook.run();
                }
            }
        });
    }

    private void fail(String failureClass) {
        final boolean resume = pendingResume;
        pendingResume = false;
        /* Build H: the failure is announced BY CLASS, so the
           ledger records which class spoke and which line it
           spoke (the L14(a) attribution seam) — through Build G
           every failure landed as one undifferentiated job and
           no class could be proven from the product's records. */
        announcer.sayFailure(failureClass, rate, lang, new Runnable() {
                    @Override public void run() {
                        if (resume && announcementResumeHook != null) {
                            announcementResumeHook.run();
                        }
                    }
                });
    }

    /** Split a composed answer into announcer pieces on sentence
     *  boundaries (the response-unit shape: lead, content,
     *  completion stay separate pieces). */
    static String[] piecesOf(String text) {
        List<String> out = new ArrayList<String>();
        for (String s : Chunker.chunksOf(text)) {
            out.add(s);
        }
        if (out.isEmpty()) out.add(text);
        return out.toArray(new String[0]);
    }

    static String normalize(String text) {
        String t = text == null ? "" : text.toLowerCase().trim();
        t = t.replaceFirst("^(hey|ok|okay|please|dogear|dog ear)[,.\\s]+", "");
        t = t.replaceAll("[.!?\\s]+$", "").trim();
        return t;
    }

    private void diagEvent(String name, String detail) {
        if (diag == null) return;
        try {
            JSONObject d = new JSONObject();
            d.put("text", detail);
            diag.event(name, d, System.currentTimeMillis());
        } catch (Exception ignored) {}
    }
}

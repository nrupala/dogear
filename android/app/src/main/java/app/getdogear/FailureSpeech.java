package app.getdogear;

import java.util.HashMap;
import java.util.Map;

/**
 * Native failure speech (redesign FUNCTION; the R3 census ported
 * from the web build — VOICE-QUALITY-BETA6.md §R3, census AFTER
 * table). Every failure the Talk loop can meet has a class, and
 * every class has ONE line that states the cause AND the remedy,
 * spoken to completion by the Announcer — never shown silently,
 * never a bare string, never a raw runtime message passed
 * through as prose. The census discipline holds here as a test:
 * FailureSpeechTest fails if a class loses its line or a line
 * loses its remedy shape.
 *
 * Classes mirror what the layers below can actually emit:
 * VoiceCapture's capture classes (permission-needed, permission,
 * busy, none, error), the voice engine's states (pack-absent,
 * engine-memory, engine-generic, decode), and the router's own
 * exits (no-speech, unknown, no-document).
 */
public final class FailureSpeech {

    public static final String CAPTURE_PERMISSION_NEEDED = "permission-needed";
    public static final String CAPTURE_PERMISSION = "permission";
    public static final String CAPTURE_BUSY = "busy";
    public static final String CAPTURE_NONE = "none";
    public static final String CAPTURE_ERROR = "error";
    public static final String PACK_ABSENT = "pack-absent";
    public static final String ENGINE_MEMORY = "engine-memory";
    public static final String ENGINE_GENERIC = "engine-generic";
    public static final String DECODE = "decode";
    public static final String NO_SPEECH = "no-speech";
    public static final String UNKNOWN = "unknown";
    public static final String NO_DOCUMENT = "no-document";

    private static final Map<String, String> LINES = new HashMap<String, String>();

    static {
        // Native capture classes — the web census AFTER wording
        // (app.js CAPTURE_CLASS_COPY), unchanged: class
        // separation is doctrine (never conflate mic classes).
        LINES.put(CAPTURE_PERMISSION,
                "The microphone is blocked. DogEar needs your permission to "
                        + "listen \u2014 nothing is recorded without it.");
        LINES.put(CAPTURE_PERMISSION_NEEDED,
                "DogEar needs the microphone permission before it can listen. "
                        + "If Android is asking, tap Allow \u2014 nothing is "
                        + "recorded without your permission. If no prompt "
                        + "appears, check DogEar\u2019s permissions in Android "
                        + "Settings, under Apps.");
        LINES.put(CAPTURE_BUSY,
                "The microphone could not be opened \u2014 it may be busy with "
                        + "another app. Close anything using the microphone and "
                        + "try again. Your permission is not the problem.");
        LINES.put(CAPTURE_NONE,
                "No microphone was found on this device, so Talk cannot listen "
                        + "here. Reading aloud still works as always.");
        LINES.put(CAPTURE_ERROR,
                "Listening was interrupted before it could start \u2014 the "
                        + "microphone never opened. Nothing was recorded. Tap "
                        + "Talk and try once more.");
        // Engine classes — class-mapped elaboration, never raw.
        LINES.put(PACK_ABSENT,
                "The voice pack is not on this device yet \u2014 choose a model "
                        + "in Settings, under Voice pack, download it, then "
                        + "Talk again.");
        LINES.put(ENGINE_MEMORY,
                "The voice engine ran into a memory problem and could not "
                        + "finish listening. Try again \u2014 and if it keeps "
                        + "happening, a smaller model from the voice shelf in "
                        + "Settings is the way out.");
        LINES.put(ENGINE_GENERIC,
                "The voice engine could not finish that. Nothing was saved "
                        + "or sent anywhere. Tap Talk and try again.");
        LINES.put(DECODE,
                "What was recorded could not be read back, so nothing was "
                        + "understood. Hold the phone a little closer and try "
                        + "Talk again.");
        // Router exits.
        LINES.put(NO_SPEECH,
                "I couldn\u2019t make that out \u2014 try again, a little "
                        + "closer to the microphone.");
        LINES.put(UNKNOWN,
                "I don\u2019t know how to do that yet. You can ask me about "
                        + "the document, ask what the buttons do, or say "
                        + "pause, resume, go back, or stop.");
        LINES.put(NO_DOCUMENT,
                "No document is open, so there is nothing to ask about yet. "
                        + "Open a document from the Library first, then Talk "
                        + "to me about it.");
    }

    private FailureSpeech() {}

    /** The spoken line for a failure class. An unmapped class
     *  falls to the generic engine line — a failure is never
     *  silent and never raw. */
    public static String lineFor(String failureClass) {
        String line = failureClass == null ? null : LINES.get(failureClass);
        return line != null ? line : LINES.get(ENGINE_GENERIC);
    }

    /** Every class the table knows — the census test walks this. */
    public static String[] classes() {
        return LINES.keySet().toArray(new String[0]);
    }
}

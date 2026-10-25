package app.getdogear;

/**
 * The speech service's speak verb, as the native feeding and
 * announcement layers use it: an integer utterance id (the
 * service's own id space — the document feeder uses the chunk
 * index, the announcer uses a high range), the text, rate and
 * language tag. Implemented in MainActivity over SpeechService
 * (direct call to the running service; foreground-service start
 * when none is running).
 */
public interface IntSpeaker {
    void speak(int utteranceId, String text, float rate, String lang);
}

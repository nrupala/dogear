package app.getdogear;

import android.content.Context;
import android.webkit.JavascriptInterface;

/**
 * The page-side half of the DogEar speech bridge. Exposed to the web
 * app as {@code window.DogEarNative} — and ONLY there; no other page
 * is ever loaded into this WebView's shell origin flow. Calls forward
 * to {@link SpeechService}, which owns the device TTS engine from a
 * foreground service so reading survives the app being minimized or
 * the screen turning off.
 *
 * Delivery: when the service is already running, calls go DIRECTLY
 * to its instance — chunk traffic must survive the app being
 * backgrounded, and Android's background-start restrictions can
 * refuse service starts from a backgrounded page, while an
 * in-process call to the running foreground service always works.
 * Only the first speak (no service yet — the user just pressed
 * Listen, app in the foreground) starts it, via the intent path.
 *
 * Protocol: see native-bridge.js (the speechSynthesis transport shim)
 * and android/BACKGROUND-PLAYBACK.md.
 */
public class DogEarJsBridge {
    private final Context appContext;

    public DogEarJsBridge(Context context) {
        this.appContext = context.getApplicationContext();
    }

    @JavascriptInterface
    public void speak(int id, String text, double rate, String lang) {
        SpeechService a = SpeechService.active();
        if (a != null) {
            a.speakChunk(id, text, (float) rate, lang);
        } else {
            SpeechService.speak(appContext, id, text, (float) rate, lang);
        }
    }

    @JavascriptInterface
    public void pausePlayback() {
        SpeechService a = SpeechService.active();
        if (a != null) a.pauseFromBridge();
        else SpeechService.pausePlayback(appContext);
    }

    @JavascriptInterface
    public void resumePlayback() {
        SpeechService a = SpeechService.active();
        if (a != null) a.resumeFromBridge();
        else SpeechService.resumePlayback(appContext);
    }

    @JavascriptInterface
    public void stopPlayback() {
        SpeechService a = SpeechService.active();
        if (a != null) a.stopFromBridge();
        else SpeechService.stopPlayback(appContext);
    }

    @JavascriptInterface
    public void skipCurrent() {
        SpeechService a = SpeechService.active();
        if (a != null) a.skipFromBridge();
        else SpeechService.skipCurrent(appContext);
    }

    @JavascriptInterface
    public void setNowPlaying(String title) {
        SpeechService a = SpeechService.active();
        if (a != null) a.setTitleFromBridge(title);
        else SpeechService.setNowPlaying(appContext, title);
    }
}

package app.getdogear;

import android.content.Context;
import android.webkit.JavascriptInterface;

/**
 * The page-side half of the DogEar speech bridge. Exposed to the web
 * app as {@code window.DogEarNative} — and ONLY there; no other page
 * is ever loaded into this WebView's shell origin flow. Every call
 * forwards to {@link SpeechService}, which owns the device TTS engine
 * from a foreground service so reading survives the app being
 * minimized or the screen turning off.
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
        SpeechService.speak(appContext, id, text, (float) rate, lang);
    }

    @JavascriptInterface
    public void pausePlayback() {
        SpeechService.pausePlayback(appContext);
    }

    @JavascriptInterface
    public void resumePlayback() {
        SpeechService.resumePlayback(appContext);
    }

    @JavascriptInterface
    public void stopPlayback() {
        SpeechService.stopPlayback(appContext);
    }

    @JavascriptInterface
    public void skipCurrent() {
        SpeechService.skipCurrent(appContext);
    }

    @JavascriptInterface
    public void setNowPlaying(String title) {
        SpeechService.setNowPlaying(appContext, title);
    }
}

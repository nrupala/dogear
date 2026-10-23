package app.getdogear;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;

import java.lang.ref.WeakReference;

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
    private final WeakReference<Activity> activityRef;

    public DogEarJsBridge(Context context) {
        this.appContext = context.getApplicationContext();
        this.activityRef = new WeakReference<>(
                context instanceof Activity ? (Activity) context : null);
    }

    /** Battery-exemption state for the reader's one-time hint.
     *  Some phones (Samsung One UI app-sleep is the proven case)
     *  kill even a foreground-service app whose battery mode is
     *  restricted; stock Android does not. The page asks, shows
     *  the reason once, and only on the user's tap calls
     *  requestBatteryExemption(). */
    @JavascriptInterface
    public boolean isIgnoringBatteryOptimizations() {
        try {
            PowerManager pm = (PowerManager)
                    appContext.getSystemService(Context.POWER_SERVICE);
            return pm != null && pm.isIgnoringBatteryOptimizations(
                    appContext.getPackageName());
        } catch (Exception e) {
            return true; // unknown → never nag
        }
    }

    @JavascriptInterface
    public void requestBatteryExemption() {
        Activity a = activityRef.get();
        if (a == null) return;
        a.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Intent i = new Intent(
                            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    i.setData(Uri.parse("package:" + appContext.getPackageName()));
                    a.startActivity(i);
                } catch (Exception e) {
                    try {
                        a.startActivity(new Intent(
                                Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                    } catch (Exception ignored) {}
                }
            }
        });
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

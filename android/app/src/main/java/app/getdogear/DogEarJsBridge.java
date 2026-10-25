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
 * The page-side half of the DogEar native bridge. Exposed to the
 * web app as {@code window.DogEarNative} — and ONLY there; no other
 * page is ever loaded into this WebView's shell origin flow.
 *
 * Beta.5 (app-first): the bridge no longer forwards transport calls
 * straight to the speech service. Playback/voice STATE lives in
 * {@link PlayerCore} — the one machine the native bar, the media
 * session and this page all command — so the bridge routes the
 * page's intents into the core (Source.PAGE), reports the session
 * (document + the reader's own place record, read by the bridge JS
 * at speak time) into it, and exposes the native capture + marks
 * the page reflects. The speak path itself still goes directly to
 * the running {@link SpeechService} instance (chunk traffic must
 * survive backgrounding; see the service), and the service is the
 * core's SpeechPort, so the two never disagree about the voice.
 *
 * Protocol: see native-bridge.js (the speechSynthesis transport
 * shim) and android/BACKGROUND-PLAYBACK.md + APP-FIRST-BETA5.md.
 */
public class DogEarJsBridge {
    private final Context appContext;
    private final WeakReference<Activity> activityRef;

    public DogEarJsBridge(Context context) {
        this.appContext = context.getApplicationContext();
        this.activityRef = new WeakReference<>(
                context instanceof Activity ? (Activity) context : null);
    }

    private PlayerCore core() {
        return PlayerCoreProvider.get(appContext);
    }

    // ------------------------------------------------------------------
    // Battery exemption (reader hint; unchanged from beta.4)
    // ------------------------------------------------------------------

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

    // ------------------------------------------------------------------
    // Session + position (the bridge JS reports; the core persists)
    // ------------------------------------------------------------------

    /** A document opened in the reader. seedChunk/seedChunks come
     *  from the reader's own place record when one exists. */
    @JavascriptInterface
    public void setSession(String docId, String title, int seedChunk, int seedChunks) {
        core().sessionStarted(docId, title, seedChunk, seedChunks);
    }

    @JavascriptInterface
    public void clearSession() {
        core().sessionEnded();
    }

    /** The reader's place record at speak time: the chunk about to
     *  be spoken and the document's chunk total. This is the
     *  position truth the core persists on every chunk. */
    @JavascriptInterface
    public void noteChunk(int chunkIndex, int chunkTotal) {
        core().utteranceSpoke(chunkIndex, chunkTotal);
    }

    // ------------------------------------------------------------------
    // Speech transport (the shim's calls)
    // ------------------------------------------------------------------

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
        core().pause(PlayerCore.Source.PAGE);
    }

    @JavascriptInterface
    public void resumePlayback() {
        core().resume(PlayerCore.Source.PAGE);
    }

    @JavascriptInterface
    public void stopPlayback() {
        // 1.1.0 HARDENING (F-B5-2; REPROOF-BETA5-CI cycle 18: a
        // Resume press acted as Stop): this verb sits behind the
        // page synth's cancel() — a ROUTINE engine reset that
        // reader-core calls on every play-from-idle, rate change
        // and stopAll. It must never carry user-Stop authority.
        // Voice-only now (the service's lightStop: voice stops,
        // session and core untouched). The core's stop doors are
        // the explicit ones only — the bar's Stop button, the
        // media session's stop, and the page's
        // playerCommand("stop").
        SpeechService a = SpeechService.active();
        if (a != null) a.stopFromBridge();
        else android.util.Log.w("DogEarBridge",
                "stopPlayback with no live speech service: nothing to silence, core untouched");
    }

    @JavascriptInterface
    public void skipCurrent() {
        SpeechService a = SpeechService.active();
        if (a != null) a.skipFromBridge();
        else SpeechService.skipCurrent(appContext);
    }

    @JavascriptInterface
    public void setNowPlaying(String title) {
        core().sessionTitle(title);
        SpeechService a = SpeechService.active();
        if (a != null) a.setTitleFromBridge(title);
        else SpeechService.setNowPlaying(appContext, title);
    }

    // ------------------------------------------------------------------
    // PlayerCore surface for the page (commands + reflection)
    // ------------------------------------------------------------------

    /** Idempotent player verbs from the page's own controls, so a
     *  tap in the page and a tap on the native bar are the same
     *  event in the same machine:
     *  play | pause | resume | stop | save | continue | favorite |
     *  next | prev */
    @JavascriptInterface
    public void playerCommand(String cmd) {
        if (cmd == null) return;
        PlayerCore c = core();
        switch (cmd) {
            case "play": c.play(PlayerCore.Source.PAGE); break;
            case "pause": c.pause(PlayerCore.Source.PAGE); break;
            case "resume": c.resume(PlayerCore.Source.PAGE); break;
            case "stop": c.stop(PlayerCore.Source.PAGE); break;
            case "save": c.savePlace(PlayerCore.Source.PAGE); break;
            case "continue": c.continueSaved(PlayerCore.Source.PAGE); break;
            case "favorite": c.toggleFavorite(PlayerCore.Source.PAGE); break;
            case "next": c.next(PlayerCore.Source.PAGE); break;
            case "prev": c.prev(PlayerCore.Source.PAGE); break;
            default: break;
        }
    }

    /** The current snapshot (same JSON the page receives as push
     *  events) — a pull for the page's first render. */
    @JavascriptInterface
    public String getPlayerState() {
        return core().snapshot().toString();
    }

    /** One document's marks: {favorite, position, bookmarks, tags,
     *  notes} — the page renders them in its Marks panel. */
    @JavascriptInterface
    public String getMarks(String docId) {
        return core().marksFor(docId).toString();
    }

    // ------------------------------------------------------------------
    // Native Talk capture (the page's Talk button, second surface)
    // ------------------------------------------------------------------

    /** Begin native capture. PlayerCore silences the voice first;
     *  the captured audio returns to the page as a player event
     *  (window.__dogearPlayerEvent, {"t":"audio",...}) and the
     *  page's unchanged voice engine transcribes it. */
    @JavascriptInterface
    public void startCapture() {
        core().talkStart(PlayerCore.Source.PAGE);
    }

    @JavascriptInterface
    public void stopCapture() {
        core().talkStop();
    }
}

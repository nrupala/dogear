package app.getdogear;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

import java.util.Locale;

/**
 * DogEar's native playback service: a foreground service
 * (mediaPlayback) that speaks the web reader's chunks with the
 * DEVICE's own TextToSpeech engine — the device's voices, on-device,
 * nothing recorded, nothing uploaded.
 *
 * The web layer (reader-core, via the native-bridge.js transport
 * shim) remains the brain: it owns the document, the chunk order and
 * the reading place, and sends ONE chunk at a time. This service is
 * the voice box: it speaks the chunk, reports start/end/error back
 * into the page (which is what advances the position), and exposes
 * media notification + lock-screen controls whose actions route
 * back through the page's reader so UI state and voice never drift.
 *
 * Pause semantics: Android TTS has no mid-utterance pause, so pause
 * stops the voice mid-chunk and resume re-speaks the current chunk
 * from its start (chunks are ~240 chars — a sentence or two).
 *
 * Beta.5 (app-first): this service is the VOICE BOX only. The one
 * playback state machine is {@link PlayerCore}; this service takes
 * its transport orders from the core (it is the core's SpeechPort),
 * reports utterance lifecycle, and its media session / notification
 * / focus-loss paths command the core like every other surface —
 * no private state decides anything user-visible alone.
 */
public class SpeechService extends Service implements PlayerCore.SpeechPort {

    /** Receives JSON event strings destined for the page. */
    public interface EventSink {
        void onSpeechEvent(String json);
    }

    private static volatile EventSink eventSink;

    public static void setEventSink(EventSink sink) {
        eventSink = sink;
    }

    private static final String PKG = "app.getdogear.speech.";
    public static final String ACTION_SPEAK = PKG + "SPEAK";
    public static final String ACTION_PAUSE = PKG + "PAUSE";
    public static final String ACTION_RESUME = PKG + "RESUME";
    public static final String ACTION_STOP_PLAYBACK = PKG + "STOP_PLAYBACK";
    public static final String ACTION_SKIP_CURRENT = PKG + "SKIP_CURRENT";
    public static final String ACTION_SET_TITLE = PKG + "SET_TITLE";
    public static final String ACTION_CTRL_PAUSE = PKG + "CTRL_PAUSE";
    public static final String ACTION_CTRL_RESUME = PKG + "CTRL_RESUME";
    public static final String ACTION_CTRL_NEXT = PKG + "CTRL_NEXT";
    public static final String ACTION_CTRL_PREV = PKG + "CTRL_PREV";
    public static final String ACTION_CTRL_STOP = PKG + "CTRL_STOP";

    private static final String CHANNEL_ID = "dogear-playback";
    private static final int NOTIF_ID = 4101;

    private static final int STATE_IDLE = 0;
    private static final int STATE_PLAYING = 1;
    private static final int STATE_PAUSED = 2;

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean pendingSpeak = false;

    private int state = STATE_IDLE;
    private boolean sessionActive = false;
    private boolean foregroundStarted = false;
    // Whether the current chunk is audibly sounding right now
    // (utterance started, not yet done/stopped). Resume consults
    // it: a resume that lands while the chunk is already sounding
    // (e.g. the core's media resume and the page's echo of it
    // arriving back to back) must not restart the chunk.
    private boolean chunkSounding = false;

    // The single outstanding chunk (the shim serializes utterances).
    private Integer currentId = null;
    private String currentText = null;
    private float currentRate = 1f;
    private String currentLang = null;

    private String nowTitle = "DogEar";
    private boolean focusPaused = false;

    private MediaSessionCompat mediaSession;
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest;
    private PowerManager.WakeLock wakeLock;

    // ------------------------------------------------------------------
    // Static entry points (called by the JS bridge and the activity)
    // ------------------------------------------------------------------

    public static void speak(Context ctx, int id, String text, float rate, String lang) {
        Intent i = new Intent(ctx, SpeechService.class).setAction(ACTION_SPEAK);
        i.putExtra("id", id);
        i.putExtra("text", text);
        i.putExtra("rate", rate);
        i.putExtra("lang", lang);
        ContextCompat.startForegroundService(ctx, i);
    }

    public static void pausePlayback(Context ctx) {
        startControl(ctx, ACTION_PAUSE);
    }

    public static void resumePlayback(Context ctx) {
        startControl(ctx, ACTION_RESUME);
    }

    public static void stopPlayback(Context ctx) {
        startControl(ctx, ACTION_STOP_PLAYBACK);
    }

    public static void skipCurrent(Context ctx) {
        startControl(ctx, ACTION_SKIP_CURRENT);
    }

    // Title updates never start the service. Starting it just to
    // set a title created + destroyed the service (and bound the
    // TTS engine) on every document open — and the destroy raced
    // the TTS init callback (see onInit). The title is a hint the
    // service picks up when it actually starts; a running service
    // gets it applied directly.
    private static volatile String titleHint = "DogEar";

    public static void setNowPlaying(Context ctx, String title) {
        if (title != null && !title.isEmpty()) titleHint = title;
        SpeechService a = activeInstance;
        if (a != null) a.setTitleFromBridge(title);
    }

    private static void startControl(Context ctx, String action) {
        // A page-side control for a service that is not running has
        // nothing to control — and must not CREATE one: an instance
        // born of a stray cancel stopSelfs immediately, and a speak
        // landing on it in the same breath dies with it (emulator
        // proof, 2026-10-22). The notification's own PendingIntents
        // do not come through here; a genuine user tap on a live
        // notification implies a running service anyway.
        if (active() == null) return;
        startControlIntent(ctx, new Intent(ctx, SpeechService.class).setAction(action));
    }

    private static void startControlIntent(Context ctx, Intent i) {
        try {
            ctx.startService(i);
        } catch (IllegalStateException e) {
            // Background start restrictions: a control for a service
            // that is not running has nothing to control anyway.
        }
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    // The running instance, for the JS bridge's direct-call path.
    // Chunk traffic must NOT go through startService intents: once
    // the app is backgrounded (the entire point of this service),
    // Android's background-start restrictions can refuse or throw on
    // service starts from the page, while a direct in-process call to
    // the already-running foreground service always works. Intents
    // remain the entry for the notification / media-session controls,
    // which hold their own platform exemptions.
    private static volatile SpeechService activeInstance;

    // Set in onDestroy. A destroyed instance must never receive
    // direct calls: the emulator proof (2026-10-22) showed the
    // engine's reset-cancel creating an instance that stopSelf'd at
    // once, the speak 4ms later landing on the corpse via this path,
    // and its pending utterance waiting forever on an init callback
    // the (correct) null-guard swallowed. Playback never started;
    // the page's watchdog then "failed" speech that was never given
    // a living service.
    private volatile boolean destroyed = false;

    public static SpeechService active() {
        SpeechService a = activeInstance;
        return (a != null && !a.destroyed) ? a : null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        activeInstance = this;
        nowTitle = titleHint;
        createChannel();
        // Foreground IMMEDIATELY, before any intent is handled: a
        // startForegroundService() start whose onStartCommand is
        // delayed (frozen main thread, slow device) otherwise outruns
        // the system's startForeground deadline and the OS kills the
        // whole app (ForegroundServiceDidNotStartInTimeException —
        // reproduced in the emulator proof, 2026-10-21). Starting
        // foreground at birth makes every later start safe by
        // construction; ensureForeground() refreshes the content.
        try { ensureForeground(); } catch (Exception ignored) {}
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "dogear:reading");
            wakeLock.setReferenceCounted(false);
        }
        mediaSession = new MediaSessionCompat(this, "DogEarSession");
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override public void onPlay() { core().resume(PlayerCore.Source.MEDIA); }
            @Override public void onPause() { core().pause(PlayerCore.Source.MEDIA); }
            @Override public void onSkipToNext() { core().next(PlayerCore.Source.MEDIA); }
            @Override public void onSkipToPrevious() { core().prev(PlayerCore.Source.MEDIA); }
            @Override public void onStop() { core().stop(PlayerCore.Source.MEDIA); }
        });
        // The core's SpeechPort: transport orders arrive here.
        PlayerCoreProvider.get(this).attachSpeech(this);
        tts = new TextToSpeech(getApplicationContext(), new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                // This callback can land AFTER teardown (a title-only
                // start stopSelfs immediately; teardownTts nulls the
                // field while init is still in flight). Dereferencing
                // the field here crashed the whole process with an
                // NPE in the emulator proof (2026-10-22). An init
                // callback for a dead service is a no-op, full stop.
                TextToSpeech engine = tts;
                if (engine == null) return;
                ttsReady = (status == TextToSpeech.SUCCESS);
                if (ttsReady) {
                    engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String utteranceId) {
                            chunkSounding = true;
                            Integer id = parseId(utteranceId);
                            if (id != null) emit("{\"t\":\"start\",\"id\":" + id + "}");
                        }

                        @Override public void onDone(String utteranceId) {
                            chunkSounding = false;
                            Integer id = parseId(utteranceId);
                            if (id != null && id.equals(currentId)) {
                                // 1.1.0 HARDENING (F-B5-2, the dead-
                                // resume face): RETAIN the finished
                                // chunk as the held chunk. Clearing
                                // it here meant a pause landing in
                                // the boundary gap (end emitted, the
                                // page not yet advanced) left
                                // resumeChunk() holding nothing — it
                                // silently no-opped while every
                                // surface reported "playing", and
                                // playback never revived. speakChunk
                                // replaces the held chunk; lightStop
                                // and teardown still clear it.
                                emit("{\"t\":\"end\",\"id\":" + id + "}");
                            }
                        }

                        @Override public void onStop(String utteranceId, boolean interrupted) {
                            // Deliberate stops (pause / skip / focus) land
                            // here. The page is driven by its own calls,
                            // never by this callback — nothing to emit.
                        }

                        @Override public void onError(String utteranceId, int errorCode) {
                            onError(utteranceId);
                        }

                        @Override public void onError(String utteranceId) {
                            chunkSounding = false;
                            Integer id = parseId(utteranceId);
                            if (id != null && id.equals(currentId)) {
                                currentId = null;
                                emit("{\"t\":\"error\",\"id\":" + id + "}");
                            }
                        }
                    });
                    if (pendingSpeak && currentId != null) {
                        pendingSpeak = false;
                        speakNow();
                    }
                } else if (currentId != null) {
                    // No TTS engine available at all: fail the chunk
                    // honestly rather than hanging the reader.
                    int id = currentId;
                    currentId = null;
                    emit("{\"t\":\"error\",\"id\":" + id + "}");
                }
            }
        });
    }

    // ------------------------------------------------------------------
    // Instance entry points (JS bridge direct calls + intent handling
    // share these). Work is posted to the main looper so bridge calls
    // (JavaBridge thread) get identical threading to onStartCommand.
    // ------------------------------------------------------------------

    public void speakChunk(final int id, final String text, final float rate, final String lang) {
        if (destroyed) {
            // Never speak into a corpse: re-enter through the
            // foreground-service start, which builds a fresh,
            // living instance (the user just pressed Listen).
            speak(getApplicationContext(), id, text, rate, lang);
            return;
        }
        idleHandler.post(new Runnable() {
            @Override public void run() {
                currentId = id;
                currentText = text;
                currentRate = rate;
                currentLang = lang;
                state = STATE_PLAYING;
                sessionActive = true;
                focusPaused = false;
                cancelIdleTeardown();
                ensureForeground();
                requestFocus();
                speakNow();
            }
        });
    }

    public void pauseFromBridge() {
        idleHandler.post(new Runnable() {
            @Override public void run() { userPause(); }
        });
    }

    public void resumeFromBridge() {
        idleHandler.post(new Runnable() {
            @Override public void run() { resumeChunk(); }
        });
    }

    public void stopFromBridge() {
        idleHandler.post(new Runnable() {
            @Override public void run() { lightStop(); }
        });
    }

    public void skipFromBridge() {
        idleHandler.post(new Runnable() {
            @Override public void run() { skipChunk(); }
        });
    }

    public void setTitleFromBridge(final String title) {
        idleHandler.post(new Runnable() {
            @Override public void run() { applyTitle(title); }
        });
    }

    private void resumeChunk() {
        if (currentId != null) {
            if (chunkSounding) {
                // Already sounding (a duplicate resume — the core's
                // command and the page's echo of it): restarting
                // the chunk would be the audible stutter of the old
                // multi-machine design. Hold state, do not re-speak.
                state = STATE_PLAYING;
                refreshUi();
                return;
            }
            state = STATE_PLAYING;
            focusPaused = false;
            cancelIdleTeardown();
            requestFocus();
            speakNow();
            refreshUi();
        } else {
            // Loud, never silent (Gate 12): a resume with nothing
            // held means an earlier stop cleared the session — the
            // surfaces must not claim "playing" over this.
            android.util.Log.w("DogEarSpeech",
                    "resumeChunk: nothing held (state=" + state + ") — resume is a no-op");
        }
    }

    // ------------------------------------------------------------------
    // PlayerCore SpeechPort (transport orders from the one machine)
    // ------------------------------------------------------------------

    private PlayerCore core() {
        return PlayerCoreProvider.get(this);
    }

    @Override
    public void pauseVoice() {
        idleHandler.post(new Runnable() {
            @Override public void run() { userPause(); }
        });
    }

    @Override
    public void resumeVoice() {
        idleHandler.post(new Runnable() {
            @Override public void run() { resumeChunk(); }
        });
    }

    @Override
    public void stopVoice() {
        idleHandler.post(new Runnable() {
            @Override public void run() { lightStop(); }
        });
    }

    private void skipChunk() {
        if (ttsReady && tts != null) {
            try { tts.stop(); } catch (Exception ignored) {}
        }
    }

    private void applyTitle(String t) {
        if (t != null && !t.isEmpty()) nowTitle = t;
        refreshUi();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null || intent.getAction() == null) {
            return START_NOT_STICKY;
        }
        String action = intent.getAction();
        switch (action) {
            case ACTION_SPEAK:
                speakChunk(intent.getIntExtra("id", -1),
                        intent.getStringExtra("text"),
                        intent.getFloatExtra("rate", 1f),
                        intent.getStringExtra("lang"));
                break;
            case ACTION_PAUSE:
                core().pause(PlayerCore.Source.PAGE);
                break;
            case ACTION_RESUME:
                core().resume(PlayerCore.Source.PAGE);
                break;
            case ACTION_STOP_PLAYBACK:
                // 1.1.0: voice-only, like the bridge verb (see
                // DogEarJsBridge.stopPlayback) — never a core stop.
                stopVoice();
                break;
            case ACTION_SKIP_CURRENT:
                skipChunk();
                break;
            case ACTION_SET_TITLE:
                applyTitle(intent.getStringExtra("title"));
                break;
            case ACTION_CTRL_PAUSE:
                core().pause(PlayerCore.Source.MEDIA);
                break;
            case ACTION_CTRL_RESUME:
                core().resume(PlayerCore.Source.MEDIA);
                break;
            case ACTION_CTRL_NEXT:
                core().next(PlayerCore.Source.MEDIA);
                break;
            case ACTION_CTRL_PREV:
                core().prev(PlayerCore.Source.MEDIA);
                break;
            case ACTION_CTRL_STOP:
                core().stop(PlayerCore.Source.MEDIA);
                break;
            default:
                break;
        }
        // A control intent that found no session has no work: don't
        // linger as an empty started service.
        if (!ACTION_SPEAK.equals(action) && !sessionActive) {
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        if (activeInstance == this) activeInstance = null;
        PlayerCoreProvider.get(this).detachSpeech(this);
        teardownTts();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
        }
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // Speaking
    // ------------------------------------------------------------------

    private void speakNow() {
        if (currentId == null || currentText == null) return;
        if (!ttsReady) {
            pendingSpeak = true;
            return;
        }
        try {
            if (currentLang != null) {
                Locale loc = Locale.forLanguageTag(currentLang);
                if (tts.isLanguageAvailable(loc) >= TextToSpeech.LANG_AVAILABLE) {
                    tts.setLanguage(loc);
                }
            }
        } catch (Exception ignored) {}
        try { tts.setSpeechRate(currentRate); } catch (Exception ignored) {}
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build();
        try { tts.setAudioAttributes(attrs); } catch (Exception ignored) {}
        acquireWakeLock();
        int r = tts.speak(currentText, TextToSpeech.QUEUE_FLUSH, null, "dogear-" + currentId);
        if (r == TextToSpeech.ERROR) {
            int id = currentId;
            currentId = null;
            emit("{\"t\":\"error\",\"id\":" + id + "}");
        }
        refreshUi();
    }

    /** Pause that originates anywhere: stop the voice, keep the chunk. */
    private void userPause() {
        chunkSounding = false;
        if (ttsReady && tts != null) {
            try { tts.stop(); } catch (Exception ignored) {}
        }
        if (state == STATE_PLAYING) state = STATE_PAUSED;
        focusPaused = false;
        releaseWakeLock();
        refreshUi();
    }

    // The web engine's cancel() is a routine reset: reader-core calls
    // synth.cancel() immediately BEFORE speak() on every play, and on
    // pause/stop. It must therefore be CHEAP — stop the utterance,
    // keep the session and the foreground service alive. Treating it
    // as a teardown raced the speak intent queued right behind it and
    // killed playback before it started (emulator proof, 2026-10-22:
    // TTS bound, session destroyed 7ms later, nothing ever spoken).
    // A stop with nothing following it tears down after a grace
    // period instead; any new speak/resume cancels the timer.
    private final android.os.Handler idleHandler =
            new android.os.Handler(android.os.Looper.getMainLooper());
    private final Runnable idleTeardown = new Runnable() {
        @Override public void run() {
            if (state != STATE_PLAYING) teardown();
        }
    };

    private void lightStop() {
        chunkSounding = false;
        if (ttsReady && tts != null) {
            try { tts.stop(); } catch (Exception ignored) {}
        }
        currentId = null;
        currentText = null;
        if (state == STATE_PLAYING) state = STATE_PAUSED;
        focusPaused = false;
        releaseWakeLock();
        refreshUi();
        idleHandler.removeCallbacks(idleTeardown);
        idleHandler.postDelayed(idleTeardown, 60_000);
    }

    private void cancelIdleTeardown() {
        idleHandler.removeCallbacks(idleTeardown);
    }

    private void teardown() {
        cancelIdleTeardown();
        if (ttsReady && tts != null) {
            try { tts.stop(); } catch (Exception ignored) {}
        }
        currentId = null;
        currentText = null;
        state = STATE_IDLE;
        sessionActive = false;
        focusPaused = false;
        abandonFocus();
        releaseWakeLock();
        if (mediaSession != null) mediaSession.setActive(false);
        if (foregroundStarted) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            foregroundStarted = false;
        }
        stopSelf();
    }

    private void teardownTts() {
        if (tts != null) {
            try { tts.stop(); } catch (Exception ignored) {}
            try { tts.shutdown(); } catch (Exception ignored) {}
            tts = null;
            ttsReady = false;
        }
    }

    // ------------------------------------------------------------------
    // Media controls (notification / lock screen / media buttons)
    //
    // Beta.5: these command PlayerCore like every other surface
    // (see the media-session callback + ACTION_CTRL_* intents).
    // The core silences the voice through the SpeechPort and tells
    // the page; a page that is unreachable still gets a working
    // resume because the core's resume re-speaks the held chunk
    // directly rather than depending on the page's echo.
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Audio focus
    // ------------------------------------------------------------------

    private final AudioManager.OnAudioFocusChangeListener focusListener =
            new AudioManager.OnAudioFocusChangeListener() {
                @Override
                public void onAudioFocusChange(int change) {
                    if (change == AudioManager.AUDIOFOCUS_LOSS) {
                        // Permanent loss: a core pause, so the page
                        // and every surface agree the reader paused.
                        core().focusLost();
                    } else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT
                            || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) {
                        if (state == STATE_PLAYING && currentId != null) {
                            if (ttsReady && tts != null) {
                                try { tts.stop(); } catch (Exception ignored) {}
                            }
                            focusPaused = true;
                            releaseWakeLock();
                        }
                    } else if (change == AudioManager.AUDIOFOCUS_GAIN) {
                        if (focusPaused && state == STATE_PLAYING && currentId != null) {
                            focusPaused = false;
                            acquireWakeLock();
                            speakNow();
                        }
                    }
                }
            };

    private void requestFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                AudioAttributes attrs = new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build();
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                        .setAudioAttributes(attrs)
                        .setOnAudioFocusChangeListener(focusListener)
                        .build();
                audioManager.requestAudioFocus(focusRequest);
            } else {
                audioManager.requestAudioFocus(focusListener,
                        AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }
        } catch (Exception ignored) {}
    }

    private void abandonFocus() {
        if (audioManager == null) return;
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) {
                audioManager.abandonAudioFocusRequest(focusRequest);
                focusRequest = null;
            } else {
                audioManager.abandonAudioFocus(focusListener);
            }
        } catch (Exception ignored) {}
    }

    // ------------------------------------------------------------------
    // Foreground notification + media session state
    // ------------------------------------------------------------------

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel ch = new NotificationChannel(
                        CHANNEL_ID, "Reading playback", NotificationManager.IMPORTANCE_LOW);
                ch.setDescription("Controls for DogEar reading aloud");
                ch.setShowBadge(false);
                nm.createNotificationChannel(ch);
            }
        }
    }

    private void ensureForeground() {
        if (foregroundStarted) {
            refreshUi();
            return;
        }
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(this, NOTIF_ID, n,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, n);
        }
        foregroundStarted = true;
        if (mediaSession != null) mediaSession.setActive(true);
        refreshUi();
    }

    private Notification buildNotification() {
        PendingIntent contentIntent = PendingIntent.getActivity(this, 0,
                new Intent(this, MainActivity.class)
                        .setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        boolean playing = (state == STATE_PLAYING);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_notification_icon)
                .setContentTitle(nowTitle)
                .setContentText(playing ? "Reading aloud" : "Paused")
                .setContentIntent(contentIntent)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
                .setOngoing(playing)
                .setColor(0xFF081322)
                .addAction(android.R.drawable.ic_media_previous, "Previous chunk",
                        controlIntent(ACTION_CTRL_PREV, 1))
                .addAction(playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play,
                        playing ? "Pause" : "Resume",
                        controlIntent(playing ? ACTION_CTRL_PAUSE : ACTION_CTRL_RESUME, 2))
                .addAction(android.R.drawable.ic_media_next, "Next chunk",
                        controlIntent(ACTION_CTRL_NEXT, 3))
                .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop",
                        controlIntent(ACTION_CTRL_STOP, 4));
        if (mediaSession != null) {
            b.setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                    .setMediaSession(mediaSession.getSessionToken())
                    .setShowActionsInCompactView(0, 1, 2));
        }
        return b.build();
    }

    private PendingIntent controlIntent(String action, int requestCode) {
        Intent i = new Intent(this, SpeechService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void refreshUi() {
        if (!foregroundStarted) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_ID, buildNotification());
        if (mediaSession != null) {
            long actions = PlaybackStateCompat.ACTION_PLAY_PAUSE
                    | PlaybackStateCompat.ACTION_PLAY
                    | PlaybackStateCompat.ACTION_PAUSE
                    | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
                    | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
                    | PlaybackStateCompat.ACTION_STOP;
            int pbState = (state == STATE_PLAYING)
                    ? PlaybackStateCompat.STATE_PLAYING
                    : (state == STATE_PAUSED ? PlaybackStateCompat.STATE_PAUSED
                                              : PlaybackStateCompat.STATE_STOPPED);
            mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
                    .setActions(actions)
                    .setState(pbState, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
                    .build());
            mediaSession.setMetadata(new MediaMetadataCompat.Builder()
                    .putString(MediaMetadataCompat.METADATA_KEY_TITLE, nowTitle)
                    .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, "DogEar")
                    .build());
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private void emit(String json) {
        EventSink sink = eventSink;
        if (sink != null) sink.onSpeechEvent(json);
    }

    private static Integer parseId(String utteranceId) {
        if (utteranceId == null || !utteranceId.startsWith("dogear-")) return null;
        try {
            return Integer.parseInt(utteranceId.substring("dogear-".length()));
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private void acquireWakeLock() {
        if (wakeLock != null) {
            try { wakeLock.acquire(10 * 60 * 1000L); } catch (Exception ignored) {}
        }
    }

    private void releaseWakeLock() {
        if (wakeLock != null) {
            try {
                if (wakeLock.isHeld()) wakeLock.release();
            } catch (Exception ignored) {}
        }
    }
}

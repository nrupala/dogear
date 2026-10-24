package app.getdogear;

import android.content.Context;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;

import java.util.ArrayList;
import java.util.List;

/**
 * DogEar's native microphone capture (beta.5): AudioRecord at
 * 16 kHz mono PCM16 — exactly the sample shape the page's voice
 * engine consumes — recorded on a worker thread, capped at 20 s
 * (the page's own capture cap), existing only in memory until it
 * is handed to PlayerCore.
 *
 * Why native: the beta.4 Talk path captured in the page
 * (getUserMedia → MediaRecorder) in front of a WASM engine on the
 * renderer thread, after a page-side pause chain that could lag
 * behind the speaking service. Here PlayerCore stops the voice
 * first and only then opens the microphone — and the capture
 * itself can never be starved by renderer work.
 *
 * The audio mode is set to IN_COMMUNICATION for the capture (the
 * voice-call path every assistant uses; it is also why the shell
 * carries MODIFY_AUDIO_SETTINGS) and restored afterwards.
 * Failures are reported in the page's own classes — permission /
 * busy / none — so the honest per-class copy from beta.4 keys off
 * them unchanged.
 */
public final class VoiceCapture implements PlayerCore.CapturePort {

    private static final int SAMPLE_RATE = 16000;
    private static final int MAX_MS = 20_000;

    private final Context appContext;
    private volatile boolean capturing = false;
    private volatile AudioRecord recorder;
    private Thread thread;

    public VoiceCapture(Context ctx) {
        this.appContext = ctx.getApplicationContext();
    }

    @Override
    public void start(final Callback cb) {
        if (capturing) return;
        if (!appContext.getPackageManager()
                .hasSystemFeature(PackageManager.FEATURE_MICROPHONE)) {
            cb.onCaptureError("none");
            return;
        }
        if (appContext.checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                != PackageManager.PERMISSION_GRANTED) {
            // Never granted (or revoked): a prompt, not a failure.
            cb.onCaptureError("permission-needed");
            return;
        }
        capturing = true;
        thread = new Thread(new Runnable() {
            @Override public void run() { runCapture(cb); }
        }, "dogear-capture");
        thread.start();
    }

    @Override
    public void stop() {
        capturing = false;
        AudioRecord r = recorder;
        if (r != null) {
            try { r.stop(); } catch (Exception ignored) {}
        }
    }

    private void runCapture(Callback cb) {
        AudioManager am = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
        int previousMode = AudioManager.MODE_NORMAL;
        AudioRecord rec = null;
        List<short[]> buffers = new ArrayList<short[]>();
        int total = 0;
        String error = null;
        try {
            int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
            if (minBuf <= 0) {
                error = "none";
                throw new IllegalStateException("no buffer");
            }
            try {
                rec = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,
                        SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                        AudioFormat.ENCODING_PCM_16BIT, Math.max(minBuf, SAMPLE_RATE));
            } catch (SecurityException se) {
                error = "permission";
                throw se;
            }
            if (rec.getState() != AudioRecord.STATE_INITIALIZED) {
                error = "busy";
                throw new IllegalStateException("recorder not initialized");
            }
            recorder = rec;
            if (am != null) {
                try {
                    previousMode = am.getMode();
                    am.setMode(AudioManager.MODE_IN_COMMUNICATION);
                } catch (Exception ignored) {}
            }
            // Silence-settle window: PlayerCore stops the voice
            // before opening the mic, but the stop travels through
            // two posted handlers; a quarter second guarantees the
            // first thing the microphone hears is not the tail of
            // the sentence it just interrupted.
            try { Thread.sleep(250); } catch (InterruptedException ignored) {}
            if (!capturing) throw new IllegalStateException("stopped during settle");
            rec.startRecording();
            if (rec.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                error = "busy";
                throw new IllegalStateException("recording did not start");
            }
            short[] buf = new short[SAMPLE_RATE / 4]; // 250 ms slices
            long deadline = System.currentTimeMillis() + MAX_MS;
            while (capturing && System.currentTimeMillis() < deadline) {
                int n = rec.read(buf, 0, buf.length);
                if (n > 0) {
                    short[] copy = new short[n];
                    System.arraycopy(buf, 0, copy, 0, n);
                    buffers.add(copy);
                    total += n;
                } else if (n < 0) {
                    break;
                }
            }
        } catch (SecurityException se) {
            if (error == null) error = "permission";
        } catch (Exception e) {
            if (error == null) error = "error";
        } finally {
            capturing = false;
            recorder = null;
            if (am != null) {
                try { am.setMode(previousMode); } catch (Exception ignored) {}
            }
            if (rec != null) {
                try { rec.stop(); } catch (Exception ignored) {}
                try { rec.release(); } catch (Exception ignored) {}
            }
        }
        if (error != null) {
            cb.onCaptureError(error);
            return;
        }
        if (total == 0) {
            // The mic opened and heard nothing at all — hand the
            // page an empty capture; its engine answers with the
            // honest couldn't-make-that-out, as in beta.4.
            cb.onCaptured(new short[0], SAMPLE_RATE);
            return;
        }
        short[] all = new short[total];
        int off = 0;
        for (short[] b : buffers) {
            System.arraycopy(b, 0, all, off, b.length);
            off += b.length;
        }
        cb.onCaptured(all, SAMPLE_RATE);
    }
}

package app.getdogear;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;

import java.io.File;

/**
 * Wires the production PlayerCore: marks in a private file, native
 * capture, commands serialized on the main looper (the threading
 * the old bridge/service paths already shared), the system clock.
 * PlayerCore itself stays Android-free + JVM-tested; this class is
 * the thin Android-aware shell around it.
 */
public final class PlayerCoreProvider {

    private static volatile PlayerCore instance;

    private PlayerCoreProvider() {}

    public static PlayerCore get(Context ctx) {
        PlayerCore local = instance;
        if (local != null) return local;
        synchronized (PlayerCoreProvider.class) {
            if (instance != null) return instance;
            Context app = ctx.getApplicationContext();
            MarksStore store = new MarksStore(MarksStore.fileStorage(
                    new File(app.getFilesDir(), "dogear-marks.json")));
            final Handler main = new Handler(Looper.getMainLooper());
            PlayerCore core = new PlayerCore(
                    store,
                    new VoiceCapture(app),
                    new PlayerCore.Poster() {
                        @Override public void post(Runnable r) { main.post(r); }
                    },
                    new PlayerCore.Clock() {
                        @Override public long nowMs() { return System.currentTimeMillis(); }
                    });
            instance = core;
            return core;
        }
    }
}

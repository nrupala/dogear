package app.getdogear;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The candidate's state-diagnostics writer (redesign Phase 3):
 * every PlayerCore snapshot and every named machine event is
 * appended as one JSON object per line to
 * files/dogear-state.jsonl, so an exercise leg's state reads come
 * from the app's own record — pulled with
 *   adb exec-out run-as app.getdogear cat files/dogear-state.jsonl
 * — never from screenshots or memory. Writes are best-effort and
 * silent: diagnostics must never break the surface they observe.
 * The file rotates at ~1 MB so a long soak cannot fill storage.
 */
public final class Diagnostics {

    private static final long MAX_BYTES = 1_000_000L;
    private final File file;

    public Diagnostics(File dir) {
        this.file = new File(dir, "dogear-state.jsonl");
    }

    public synchronized void snapshot(JSONObject snapshot, long nowMs) {
        try {
            JSONObject line = new JSONObject();
            line.put("kind", "snapshot");
            line.put("at", nowMs);
            line.put("state", snapshot);
            append(line);
        } catch (Exception ignored) {}
    }

    public synchronized void event(String name, JSONObject detail, long nowMs) {
        try {
            JSONObject line = new JSONObject();
            line.put("kind", "event");
            line.put("at", nowMs);
            line.put("name", name);
            if (detail != null) line.put("detail", detail);
            append(line);
        } catch (Exception ignored) {}
    }

    private void append(JSONObject line) {
        try {
            if (file.exists() && file.length() > MAX_BYTES) {
                File old = new File(file.getParentFile(), "dogear-state.old.jsonl");
                if (old.exists()) old.delete();
                file.renameTo(old);
            }
            FileOutputStream out = new FileOutputStream(file, true);
            try {
                out.write((line.toString() + "\n").getBytes(StandardCharsets.UTF_8));
            } finally {
                out.close();
            }
        } catch (Exception ignored) {}
    }
}

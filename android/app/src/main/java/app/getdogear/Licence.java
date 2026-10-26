package app.getdogear;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import org.json.JSONObject;

/**
 * The native licence store (redesign SETTINGS, plan & licence).
 * The token format is the shipped one: base64url(payload JSON) +
 * "." + base64url(Ed25519 signature), verified against the
 * licence signing public key.
 *
 * Verification honesty (the brief's verify-seam rule): the
 * SIGNATURE check runs the shipped verifier itself —
 * licence.js + nacl inside EngineHost — because minSdk 24 has no
 * platform Ed25519. This class parses the token's structure and
 * holds the VERIFIED state: a token is only ever "unlocked" here
 * after EngineHost's verifier returned ok for these exact bytes.
 * Nothing in the native UI claims an unlock this class has not
 * recorded from that verdict.
 */
public final class Licence {

    private static final String PREFS = "dogear_licence";
    private static final String KEY_TOKEN = "token";
    private static final String KEY_VERIFIED = "verified";
    private static final String KEY_PAYLOAD = "payload";

    private final SharedPreferences prefs;

    public Licence(Context ctx) {
        prefs = ctx.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public String token() {
        return prefs.getString(KEY_TOKEN, null);
    }

    public boolean isUnlocked() {
        return prefs.getBoolean(KEY_VERIFIED, false)
                && prefs.getString(KEY_TOKEN, null) != null;
    }

    public JSONObject payload() {
        String raw = prefs.getString(KEY_PAYLOAD, null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    /** Store a token as UNVERIFIED; verification is a separate,
     *  explicit step (EngineHost) whose verdict lands in
     *  markVerified. A stored-but-unverified key unlocks nothing
     *  and Settings says exactly that. */
    public void store(String token) {
        prefs.edit()
                .putString(KEY_TOKEN, token)
                .putBoolean(KEY_VERIFIED, false)
                .remove(KEY_PAYLOAD)
                .apply();
    }

    public void markVerified(JSONObject payload) {
        prefs.edit()
                .putBoolean(KEY_VERIFIED, true)
                .putString(KEY_PAYLOAD, payload == null ? "{}" : payload.toString())
                .apply();
    }

    public void clear() {
        prefs.edit().clear().apply();
    }

    /** Structural parse only — payload JSON or null. Makes no
     *  genuineness claim; that is the verifier's job. */
    public static JSONObject parsePayload(String token) {
        if (token == null) return null;
        String[] parts = token.trim().split("\\.");
        if (parts.length != 2) return null;
        try {
            byte[] payloadBytes = Base64.decode(
                    parts[0], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            return new JSONObject(new String(payloadBytes, "UTF-8"));
        } catch (Exception e) {
            return null;
        }
    }
}

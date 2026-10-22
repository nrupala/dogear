package app.getdogear;

import android.content.Context;
import android.net.Uri;
import android.webkit.WebResourceResponse;

import androidx.webkit.WebViewAssetLoader;

import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * The local endpoint. Serves the bundled web tree (assets/web/,
 * staged by tools/bundle_web.py from the SAME tree the Worker
 * serves at https://app.getdogear.app) under the app's real origin,
 * so the tree runs unchanged: localStorage, the service worker and
 * Cache Storage are all keyed to that origin.
 *
 * The handler mirrors the Worker's serveAsset(): same route shapes,
 * same content types, the identical CSP on HTML, no-cache on HTML /
 * sw.js / manifest, the immutable cache header on /pack/v1/*.
 *
 * A path the bundle does not carry returns null — the WebView then
 * loads it from the live web endpoint. That fallthrough IS the
 * backup pathway: the web endpoint covers anything the installed
 * snapshot lacks, and no bundled path ever depends on it.
 */
final class BundledAssets {

    static final String DOMAIN = "app.getdogear.app";
    private static final String ASSET_ROOT = "web";

    /* The Worker's CSP, byte-identical (worker.js): 'wasm-unsafe-eval'
     * is what lets the voice pack's WebAssembly compile. */
    private static final String CSP =
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; " +
            "img-src 'self'; connect-src 'self'; worker-src 'self'; " +
            "manifest-src 'self'; base-uri 'none'; form-action 'self'; " +
            "frame-ancestors 'none'";

    private BundledAssets() {}

    static WebViewAssetLoader loader(Context context) {
        return new WebViewAssetLoader.Builder()
                .setDomain(DOMAIN)
                .addPathHandler("/", new Handler(context.getApplicationContext()))
                .build();
    }

    private static String mimeFor(String assetPath) {
        if (assetPath.endsWith(".html")) return "text/html";
        if (assetPath.endsWith(".js") || assetPath.endsWith(".mjs")) return "text/javascript";
        if (assetPath.endsWith(".css")) return "text/css";
        if (assetPath.endsWith(".png")) return "image/png";
        if (assetPath.endsWith(".webmanifest")) return "application/manifest+json";
        if (assetPath.endsWith(".json")) return "application/json";
        if (assetPath.endsWith(".wasm")) return "application/wasm";
        if (assetPath.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json")
                || mime.equals("application/manifest+json");
    }

    /** Loader path -> asset path inside assets/web/, or null to
     *  fall through to the network (the web endpoint). The asset
     *  loader hands the handler the path RELATIVE to the registered
     *  "/" prefix: "" for the root, "app.js" for /app.js — no
     *  leading slash (found the hard way: a handler written for
     *  "/..." paths silently misses everything and the app falls
     *  back to the network). */
    private static String assetFor(String path) {
        if (path == null || path.contains("..") || path.contains("\\")) return null;
        String p = path;
        if (p.length() > 1 && p.endsWith("/")) p = p.substring(0, p.length() - 1);
        if (p.isEmpty() || p.equals("index.html")) return ASSET_ROOT + "/index.html";
        if (p.equals("privacy")) return ASSET_ROOT + "/privacy.html";
        if (p.equals("releases")) return ASSET_ROOT + "/releases.html";
        // Everything else in the tree is served at its own name:
        // app.js, reader-core.js, vendor/*.mjs, icons/*.png, sw.js,
        // manifest.webmanifest, .well-known/assetlinks.json,
        // pack/v1/** (the voice pack rides the same rule).
        return ASSET_ROOT + "/" + p;
    }

    private static final class Handler implements WebViewAssetLoader.PathHandler {
        private final Context appContext;

        Handler(Context appContext) {
            this.appContext = appContext;
        }

        @Override
        public WebResourceResponse handle(String path) {
            String asset = assetFor(path);
            if (asset == null) return null;
            InputStream in;
            try {
                in = appContext.getAssets().open(asset);
            } catch (Exception e) {
                return null; // not in the bundle -> web endpoint (backup)
            }
            String mime = mimeFor(asset);
            WebResourceResponse res = new WebResourceResponse(
                    mime, isText(mime) ? "UTF-8" : null, in);
            Map<String, String> headers = new HashMap<>();
            headers.put("X-Content-Type-Options", "nosniff");
            headers.put("Referrer-Policy", "no-referrer");
            if (mime.equals("text/html")) {
                headers.put("Content-Security-Policy", CSP);
                headers.put("Cache-Control", "no-cache");
            } else if (asset.endsWith("/sw.js") || asset.endsWith(".webmanifest")) {
                headers.put("Cache-Control", "no-cache");
            } else if (path.startsWith("pack/")) {
                headers.put("Cache-Control", "public, max-age=31536000, immutable");
            } else {
                headers.put("Cache-Control", "public, max-age=3600");
            }
            res.setResponseHeaders(headers);
            res.setStatusCodeAndReasonPhrase(200, "OK");
            return res;
        }
    }
}

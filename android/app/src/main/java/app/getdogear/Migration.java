package app.getdogear;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;

/**
 * The one-shot first-run migration (redesign Phase 1): the
 * previous build kept the library inside the page's localStorage.
 * On the redesign's first run — native library empty, no
 * migration marker — a throwaway WebView opens the bundled page
 * once, reads the old keys, and hands them to the native stores:
 * documents keep their page ids (the native marks store already
 * keys places/marks by them), page places become live places
 * where the native store has none, and the licence token moves
 * to the native Licence store (unverified until EngineHost's
 * shipped verifier passes it — the migration claims nothing).
 *
 * The marker file is written when the attempt completes,
 * whatever it found: migration is an attempt made once, never a
 * recurring import that could resurrect deleted documents.
 */
public final class Migration {

    public interface Done {
        void onMigrationDone(int docsImported, String licenceTokenOrNull);
    }

    private static final String DUMP_JS =
            "(function(){try{"
            + "var out={docs:[],bodies:{},places:{},licence:null};"
            + "var idx=localStorage.getItem('dogearapp:docs:v1');"
            + "if(idx){try{out.docs=JSON.parse(idx)||[];}catch(e){}}"
            + "for(var i=0;i<out.docs.length;i++){var d=out.docs[i];"
            + "out.bodies[d.id]=localStorage.getItem('dogearapp:doc:'+d.id);"
            + "var p=localStorage.getItem('dogearapp:place:'+d.id);"
            + "if(p){try{out.places[d.id]=JSON.parse(p);}catch(e){}}}"
            + "out.licence=localStorage.getItem('dogearapp:licence:v1');"
            + "return JSON.stringify(out);"
            + "}catch(e){return JSON.stringify({error:String(e)});}})()";

    private Migration() {}

    public static boolean needed(Context ctx, DocumentStore docs) {
        File marker = new File(ctx.getApplicationContext().getFilesDir(),
                "dogear-migration-done");
        return !marker.exists() && docs.isEmpty();
    }

    @SuppressLint("SetJavaScriptEnabled")
    public static void run(final Context ctx, final WebViewAssetLoader loader,
                           final DocumentStore docs, final MarksStore marks,
                           final Handler main, final Done done) {
        final WebView web = new WebView(ctx);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(
                    WebView view, android.webkit.WebResourceRequest request) {
                android.webkit.WebResourceResponse r =
                        loader.shouldInterceptRequest(request.getUrl());
                return r != null ? r : super.shouldInterceptRequest(view, request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(DUMP_JS, value -> {
                    int imported = 0;
                    String licence = null;
                    try {
                        String json = value == null ? null
                                : new org.json.JSONTokener(value).nextValue().toString();
                        JSONObject out = new JSONObject(json);
                        JSONArray arr = out.optJSONArray("docs");
                        JSONObject bodies = out.optJSONObject("bodies");
                        JSONObject places = out.optJSONObject("places");
                        if (arr != null && bodies != null) {
                            for (int i = 0; i < arr.length(); i++) {
                                JSONObject d = arr.optJSONObject(i);
                                if (d == null) continue;
                                String id = d.optString("id", "");
                                String body = bodies.optString(id, null);
                                if (id.isEmpty() || body == null) continue;
                                DocumentStore.Doc doc = docs.importDoc(id,
                                        d.optString("title", ""),
                                        d.optString("kind", "text"),
                                        body, d.optLong("addedAt", 0));
                                if (doc != null) {
                                    imported++;
                                    if (places != null) {
                                        JSONObject p = places.optJSONObject(id);
                                        if (p != null
                                                && marks.positionFor(id) == null) {
                                            marks.savePosition(id, doc.title,
                                                    p.optInt("i", 0),
                                                    p.optInt("n", 0),
                                                    false, System.currentTimeMillis());
                                        }
                                    }
                                }
                            }
                        }
                        String lic = out.optString("licence", null);
                        if (lic != null && !lic.isEmpty()) licence = lic;
                    } catch (Exception ignored) {}
                    finish(ctx, web, imported, licence, done);
                });
            }
        });
        web.loadUrl("https://app.getdogear.app/");
    }

    private static void finish(Context ctx, WebView web, int imported,
                               String licence, Done done) {
        try {
            File marker = new File(ctx.getApplicationContext().getFilesDir(),
                    "dogear-migration-done");
            FileOutputStreamCompat.write(marker);
        } catch (Exception ignored) {}
        try {
            web.destroy();
        } catch (Exception ignored) {}
        if (done != null) done.onMigrationDone(imported, licence);
    }

    /** Marker write kept tiny and dependency-free. */
    private static final class FileOutputStreamCompat {
        static void write(File f) throws Exception {
            java.io.FileOutputStream out = new java.io.FileOutputStream(f);
            try {
                out.write(1);
            } finally {
                out.close();
            }
        }
    }
}

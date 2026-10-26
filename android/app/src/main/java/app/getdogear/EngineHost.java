package app.getdogear;

import android.annotation.SuppressLint;
import android.content.Context;
import android.os.Handler;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

/**
 * The ONE WebView the redesign keeps (Phase 1, FUNCTION): a
 * hidden, function-only host for the on-device Whisper engine
 * (voicepack.js) and the shipped licence verifier (licence.js).
 * It renders no UI, owns no state, holds no transport authority —
 * it transcribes audio and verifies licence signatures, and its
 * failure degrades Talk only, loudly (FailureSpeech), never the
 * reading.
 *
 * The page is a small glue script served from this class with
 * the app origin as base URL; its library scripts (/config.js,
 * /licence.js, /voicepack.js, /vendor/nacl.min.js) resolve
 * through the same WebViewAssetLoader the bundled app used, so
 * the engine that runs here is the pinned, gated engine — and
 * its Cache Storage / localStorage live under the app origin,
 * shared with what the previous build's page kept (downloaded
 * models are found, not re-downloaded).
 *
 * Events arrive on the listener as JSON:
 *   {kind:"ready"}
 *   {kind:"transcript", ok, text, cls}   cls = a FailureSpeech class
 *   {kind:"status", req, status}       voicepack status() verbatim
 *   {kind:"download", modelId, ok, reason, progress}
 *   {kind:"licence", req, ok, reason, payload}
 */
public final class EngineHost {

    public interface Listener {
        void onEngineEvent(JSONObject event);
    }

    private static final String ORIGIN = "https://app.getdogear.app";

    private static final String HOST_HTML =
            "<!doctype html><html><head><meta charset=\"utf-8\">"
            + "<script src=\"/config.js\"></script>"
            + "<script src=\"/vendor/nacl.min.js\"></script>"
            + "<script src=\"/licence.js\"></script>"
            + "<script src=\"/voicepack.js\"></script>"
            + "<script>"
            + "var pack=null;"
            + "function ensurePack(){"
            + "  if(!window.DogEarVoicePack) return false;"
            + "  if(!pack){ pack=window.DogEarVoicePack.create({"
            + "    config: window.DogEarConfig,"
            + "    isUnlocked: function(){ return !!EngineNative.isUnlocked(); }"
            + "  }); }"
            + "  return true;"
            + "}"
            + "function post(o){ EngineNative.onEvent(JSON.stringify(o)); }"
            + "function decodePcm(b64){"
            + "  var bin=atob(b64), u=new Uint8Array(bin.length);"
            + "  for(var i=0;i<bin.length;i++) u[i]=bin.charCodeAt(i);"
            + "  var dv=new DataView(u.buffer);"
            + "  var n=Math.floor(u.length/2), out=new Float32Array(n);"
            + "  for(var j=0;j<n;j++) out[j]=dv.getInt16(j*2,true)/32768;"
            + "  return out;"
            + "}"
            + "window.__transcribe=function(b64){"
            + "  if(!ensurePack()){ post({kind:'transcript',ok:false,cls:'engine-generic'}); return; }"
            + "  var samples=decodePcm(b64);"
            + "  if(!samples){ post({kind:'transcript',ok:false,cls:'decode'}); return; }"
            + "  pack.loadEngine().then(function(le){"
            + "    if(le&&le.ok===false){"
            + "      if(le.reason&&le.reason===pack.gateReason){"
            + "        post({kind:'transcript',ok:false,cls:'engine-memory'}); return;"
            + "      }"
            + "      return pack.status().then(function(st){"
            + "        var inst=st&&(st.state==='installed');"
            + "        post({kind:'transcript',ok:false,cls:inst?'engine-generic':'pack-absent'});"
            + "      });"
            + "    }"
            + "    return pack.transcribe(samples).then(function(tr){"
            + "      if(tr&&tr.ok){ post({kind:'transcript',ok:true,text:tr.text||'',silent:!!tr.silent}); }"
            + "      else { post({kind:'transcript',ok:false,cls:'engine-generic'}); }"
            + "    });"
            + "  }).catch(function(e){ post({kind:'transcript',ok:false,cls:'engine-generic'}); });"
            + "};"
            + "window.__status=function(req,modelId){"
            + "  if(!ensurePack()){ post({kind:'status',req:req,error:'engine-generic'}); return; }"
            + "  pack.status(modelId||undefined).then(function(st){"
            + "    post({kind:'status',req:req,status:st});"
            + "  }).catch(function(e){ post({kind:'status',req:req,error:'engine-generic'}); });"
            + "};"
            + "window.__download=function(modelId){"
            + "  if(!ensurePack()){ post({kind:'download',modelId:modelId,ok:false,reason:'engine'}); return; }"
            + "  pack.setSelectedModelId(modelId);"
            + "  pack.download(modelId).then(function(r){"
            + "    post({kind:'download',modelId:modelId,ok:!!(r&&r.ok),reason:(r&&r.reason)||''});"
            + "  }).catch(function(e){ post({kind:'download',modelId:modelId,ok:false,reason:'download-failed'}); });"
            + "};"
            + "window.__removeModel=function(modelId){"
            + "  if(!ensurePack()){ post({kind:'download',modelId:modelId,ok:false,reason:'engine'}); return; }"
            + "  pack.removeModel(modelId).then(function(){"
            + "    post({kind:'remove',modelId:modelId,ok:true});"
            + "  }).catch(function(e){ post({kind:'remove',modelId:modelId,ok:false}); });"
            + "};"
            + "window.__clearPack=function(){"
            + "  if(!ensurePack()){ post({kind:'clear',ok:false}); return; }"
            + "  pack.remove().then(function(){ post({kind:'clear',ok:true}); })"
            + "  .catch(function(e){ post({kind:'clear',ok:false}); });"
            + "};"
            + "window.__verifyLicence=function(req,token){"
            + "  if(!window.DogEarLicence){ post({kind:'licence',req:req,ok:false,reason:'The licence checker itself could not load.'}); return; }"
            + "  var v=window.DogEarLicence.verify(token);"
            + "  post({kind:'licence',req:req,ok:!!v.ok,reason:v.reason||'',payload:v.payload||null});"
            + "};"
            + "window.__selectedModel=function(req){"
            + "  if(!ensurePack()){ post({kind:'selected',req:req,modelId:''}); return; }"
            + "  post({kind:'selected',req:req,modelId:pack.selectedModelId||''});"
            + "};"
            + "</script></head><body></body></html>";

    private final WebView web;
    private final Handler main;
    private final Licence licence;
    private Listener listener;
    private boolean ready;
    /** Requests made before the glue page finished loading are
     *  queued, never dropped (the migration's licence check races
     *  page load by design). */
    private final java.util.List<String> pendingEvals =
            new java.util.ArrayList<String>();

    @SuppressLint("SetJavaScriptEnabled")
    public EngineHost(Context ctx, WebViewAssetLoader loader, Licence licence,
                      Handler mainHandler) {
        this.licence = licence;
        this.main = mainHandler;
        web = new WebView(ctx);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
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
                ready = true;
                for (String js : pendingEvals) {
                    try {
                        web.evaluateJavascript(js, null);
                    } catch (Exception ignored) {}
                }
                pendingEvals.clear();
                emit(simpleEvent("ready"));
            }
        });
        web.addJavascriptInterface(new Bridge(), "EngineNative");
        web.loadDataWithBaseURL(ORIGIN + "/engine-host", HOST_HTML,
                "text/html", "UTF-8", null);
    }

    public void setListener(Listener l) {
        listener = l;
    }

    public boolean isReady() {
        return ready;
    }

    public WebView view() {
        return web;
    }

    public void destroy() {
        try {
            web.destroy();
        } catch (Exception ignored) {}
    }

    // ----------------------------------------------------------
    // Requests
    // ----------------------------------------------------------

    /** Transcribe raw PCM16-LE samples (base64) — exactly what
     *  PlayerCore's audio event carries. */
    public void transcribe(String pcmBase64) {
        eval("__transcribe(" + JSONObject.quote(pcmBase64) + ")");
    }

    public void status(int req, String modelId) {
        eval("__status(" + req + ","
                + (modelId == null ? "null" : JSONObject.quote(modelId)) + ")");
    }

    public void download(String modelId) {
        eval("__download(" + JSONObject.quote(modelId) + ")");
    }

    public void removeModel(String modelId) {
        eval("__removeModel(" + JSONObject.quote(modelId) + ")");
    }

    /** Remove ALL downloaded voice-pack content (the pack's own
     *  cache clear — Settings' storage row). */
    public void clearPack() {
        eval("__clearPack()");
    }

    public void verifyLicence(int req, String token) {
        eval("__verifyLicence(" + req + "," + JSONObject.quote(token) + ")");
    }

    public void selectedModel(int req) {
        eval("__selectedModel(" + req + ")");
    }

    private void eval(final String js) {
        main.post(new Runnable() {
            @Override public void run() {
                if (!ready) {
                    pendingEvals.add(js);
                    return;
                }
                try {
                    web.evaluateJavascript(js, null);
                } catch (Exception ignored) {}
            }
        });
    }

    private JSONObject simpleEvent(String kind) {
        JSONObject o = new JSONObject();
        try {
            o.put("kind", kind);
        } catch (Exception ignored) {}
        return o;
    }

    private void emit(final JSONObject event) {
        final Listener l = listener;
        if (l == null) return;
        main.post(new Runnable() {
            @Override public void run() {
                l.onEngineEvent(event);
            }
        });
    }

    private final class Bridge {
        @JavascriptInterface
        public boolean isUnlocked() {
            return licence != null && licence.isUnlocked();
        }

        @JavascriptInterface
        public void onEvent(String json) {
            try {
                emit(new JSONObject(json));
            } catch (Exception ignored) {}
        }
    }
}

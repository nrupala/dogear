package app.getdogear;

import android.Manifest;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.PermissionRequest;
import android.webkit.ServiceWorkerClient;
import android.webkit.ServiceWorkerController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.util.Arrays;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * DogEar's own shell (replaces the TWA launcher as the entry point):
 * a full-screen WebView on https://app.getdogear.app/ with the
 * speech bridge injected. Since v1.1.0-beta.2 the page is served
 * from the bundled asset tree (see {@link BundledAssets}) under
 * the app's real origin — the app is self-contained and works
 * offline; the live site remains as the backup endpoint for the
 * paths the bundle does not carry and the /api seams. The web app
 * remains the library, the UI and the place-keeper; this activity
 * exists so playback can be owned by {@link SpeechService} and
 * keep reading while the app is minimized or the screen is off.
 *
 * Deliberate choice: this activity never calls WebView.onPause().
 * Pausing the WebView suspends the page's JS — and the page is what
 * feeds chunks to the service and records the reading place. The
 * foreground service keeps the process important; the page stays
 * live in the background and utterance callbacks keep advancing it.
 *
 * Beta.5 (app-first): the activity also hosts the NATIVE CONTROL
 * BAR (see {@link NativeControlBar}) docked under the WebView, and
 * is {@link PlayerCore}'s listener: snapshots render the bar,
 * player events forward into the page's one event channel
 * (window.__dogearSpeechEvent — the bridge dispatches them), and
 * the mic-permission retry for native capture is completed here.
 * Playback state lives in PlayerCore; this activity owns none.
 */
public class MainActivity extends Activity implements SpeechService.EventSink {

    private static final int REQ_FILE_CHOOSER = 4102;
    private static final int REQ_NOTIFICATIONS = 4103;
    private static final int REQ_MIC = 4104;
    private static final int REQ_MIC_CAPTURE = 4105;
    private static final String HOME_URL = "https://app.getdogear.app/";

    private WebView webView;
    private ValueCallback<Uri[]> fileCallback;
    private WebViewAssetLoader assetLoader;
    private PermissionRequest pendingPermissionRequest;
    private PlayerCore playerCore;
    private NativeControlBar controlBar;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(0xFF081322));

        playerCore = PlayerCoreProvider.get(this);
        playerCore.setListener(coreListener);

        webView = new WebView(this);
        webView.setLayoutParams(new ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        webView.setBackgroundColor(Color.rgb(8, 19, 34));
        // The WebView lives in a container whose PADDING carries
        // the system-bar insets (see the decor listener below):
        // padding on the WebView itself only insets its canvas and
        // leaves its layout viewport full-height — measured twice
        // in the guest (innerHeight stayed 915) before this shape.
        final android.widget.FrameLayout root = new android.widget.FrameLayout(this);
        root.setBackgroundColor(Color.rgb(8, 19, 34));
        // Beta.5 layout: [ WebView (weighted) | native control bar ]
        // in a vertical column inside the inset-padded root. The bar
        // is a standing native surface — it exists and answers
        // touches whether or not the page has rendered.
        android.widget.LinearLayout column = new android.widget.LinearLayout(this);
        column.setOrientation(android.widget.LinearLayout.VERTICAL);
        android.widget.FrameLayout webHolder = new android.widget.FrameLayout(this);
        webHolder.addView(webView);
        column.addView(webHolder, new android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        controlBar = new NativeControlBar(this, playerCore);
        column.addView(controlBar, new android.widget.LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(column);
        setContentView(root);

        // Edge-to-edge is forced at this targetSdk: without insets
        // the page paints UNDER the status bar — the app's header
        // row (Privacy / Release log / About) rendered beneath the
        // system clock and its taps were consumed by the system
        // strip (owner's phone report "the top button doesn't work
        // properly", reproduced + measured in the emulator audit
        // 2026-10-22: links at CSS y 17-40, inside the bar's touch
        // zone). Pad the WebView's container by the status-bar
        // (+cutout) and navigation-bar insets; the window background (#081322,
        // set above) fills the padded bands in the app's own
        // colour. The listener sits on the DECOR view: the first
        // build of this fix listened on the WebView itself and the
        // padding never applied — an ancestor in the dispatch
        // chain consumed the status-bar inset before it reached
        // the content view (measured: viewport stayed at full
        // height). The decor view is first in dispatch and cannot
        // be starved. Insets are returned unconsumed.
        getWindow().getDecorView().setOnApplyWindowInsetsListener(
                new android.view.View.OnApplyWindowInsetsListener() {
            @Override
            public android.view.WindowInsets onApplyWindowInsets(
                    android.view.View v, android.view.WindowInsets insets) {
                int top;
                int bottom;
                if (Build.VERSION.SDK_INT >= 30) {
                    android.graphics.Insets bars = insets.getInsets(
                            android.view.WindowInsets.Type.statusBars()
                                    | android.view.WindowInsets.Type.displayCutout());
                    android.graphics.Insets nav = insets.getInsets(
                            android.view.WindowInsets.Type.navigationBars());
                    top = bars.top;
                    bottom = nav.bottom;
                } else {
                    top = insets.getSystemWindowInsetTop();
                    bottom = insets.getSystemWindowInsetBottom();
                }
                root.setPadding(0, top, 0, bottom);
                return insets;
            }
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true); // localStorage IS the library + places
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);

        webView.addJavascriptInterface(new DogEarJsBridge(this), "DogEarNative");
        boolean debuggable = (getApplicationInfo().flags
                & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
        WebView.setWebContentsDebuggingEnabled(debuggable);

        // The local endpoint: bundled assets under the real origin.
        assetLoader = BundledAssets.loader(this);
        try {
            ServiceWorkerController.getInstance().setServiceWorkerClient(
                    new ServiceWorkerClient() {
                        @Override
                        public WebResourceResponse shouldInterceptRequest(
                                WebResourceRequest request) {
                            return assetLoader.shouldInterceptRequest(request.getUrl());
                        }
                    });
        } catch (Exception ignored) {
            // A WebView too old for service-worker control: the page
            // still loads from the bundle; only the SW's fetches
            // would ride the network. Named in BUNDLED-APP.md.
        }

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri url = request.getUrl();
                String scheme = url.getScheme();
                if (!"http".equals(scheme) && !"https".equals(scheme)) return false;
                String host = url.getHost();
                if ("app.getdogear.app".equals(host) || "getdogear.app".equals(host)) {
                    return false; // stay in the shell
                }
                // Anything else (the owner's site, credits links) goes
                // to the real browser, like a link leaving an app.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, url));
                } catch (ActivityNotFoundException ignored) {}
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                injectBridgeIfMissing(view);
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view,
                                             ValueCallback<Uri[]> callback,
                                             FileChooserParams params) {
                // The app imports documents through <input type=file>;
                // without this, file picking silently does nothing in
                // a WebView (Chrome handled it for the TWA).
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, REQ_FILE_CHOOSER);
                } catch (Exception e) {
                    try {
                        Intent fallback = new Intent(Intent.ACTION_GET_CONTENT);
                        fallback.addCategory(Intent.CATEGORY_OPENABLE);
                        fallback.setType("*/*");
                        startActivityForResult(fallback, REQ_FILE_CHOOSER);
                    } catch (Exception e2) {
                        fileCallback = null;
                        callback.onReceiveValue(null);
                    }
                }
                return true;
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // Mic capture is the only web permission the app
                // uses (Talk: the voice pack listens on-device).
                // Grant it only to our own origin, and only when
                // the Android permission itself is held.
                Uri origin = request.getOrigin();
                boolean wantsAudio = Arrays.asList(request.getResources())
                        .contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE);
                if (origin != null && BundledAssets.DOMAIN.equals(origin.getHost())
                        && wantsAudio) {
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{
                                PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        if (pendingPermissionRequest != null) {
                            pendingPermissionRequest.deny();
                        }
                        pendingPermissionRequest = request;
                        try {
                            requestPermissions(
                                    new String[]{Manifest.permission.RECORD_AUDIO},
                                    REQ_MIC);
                        } catch (Exception e) {
                            pendingPermissionRequest = null;
                            request.deny();
                        }
                    }
                    return;
                }
                request.deny();
            }
        });

        SpeechService.setEventSink(this);
        requestNotificationPermission();

        if (savedInstanceState == null) {
            webView.loadUrl(HOME_URL);
        }
    }

    /** The bridge asset is the fallback delivery: if the served page
     *  already loaded native-bridge.js itself, its flag is set and
     *  this does nothing. */
    private void injectBridgeIfMissing(final WebView view) {
        view.evaluateJavascript("window.__dogearBridgeShell===true", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String value) {
                if ("true".equals(value)) return;
                String js = readAsset("dogear-native-bridge.js");
                if (js != null) view.evaluateJavascript(js, null);
            }
        });
    }

    private String readAsset(String name) {
        try {
            InputStream in = getAssets().open(name);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) out.write(buf, 0, n);
            in.close();
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    @Override
    public void onSpeechEvent(final String json) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (webView != null) {
                    webView.evaluateJavascript(
                            "window.__dogearSpeechEvent&&window.__dogearSpeechEvent("
                                    + JSONObject.quote(json) + ")", null);
                }
            }
        });
    }

    /** PlayerCore's surface in this activity: snapshots render the
     *  native bar; page events ride the SAME channel as speech
     *  events (the bridge JS dispatches by "t"); toasts and the
     *  mic-permission retry are the activity's own. Core callbacks
     *  arrive on the main looper already (its production Poster). */
    private final PlayerCore.Listener coreListener = new PlayerCore.Listener() {
        @Override
        public void onSnapshot(org.json.JSONObject snapshot) {
            if (controlBar != null) controlBar.render(snapshot);
        }

        @Override
        public void onPageEvent(org.json.JSONObject event) {
            onSpeechEvent(event.toString());
        }

        @Override
        public void onToast(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    android.widget.Toast.makeText(
                            MainActivity.this, message,
                            android.widget.Toast.LENGTH_SHORT).show();
                }
            });
        }

        @Override
        public void onMicPermissionNeeded() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO)
                            == PackageManager.PERMISSION_GRANTED) {
                        playerCore.talkStart(PlayerCore.Source.BAR);
                        return;
                    }
                    try {
                        requestPermissions(
                                new String[]{Manifest.permission.RECORD_AUDIO},
                                REQ_MIC_CAPTURE);
                    } catch (Exception e) {
                        playerCore.capturePermissionDenied();
                    }
                }
            });
        }
    };

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
            try {
                requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},
                        REQ_NOTIFICATIONS);
            } catch (Exception ignored) {}
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode,
                                           String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_MIC_CAPTURE) {
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                // The capture that asked for this retries once.
                playerCore.talkStart(PlayerCore.Source.BAR);
            } else {
                playerCore.capturePermissionDenied();
            }
            return;
        }
        if (requestCode == REQ_MIC && pendingPermissionRequest != null) {
            PermissionRequest req = pendingPermissionRequest;
            pendingPermissionRequest = null;
            boolean granted = grantResults.length > 0
                    && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (granted) {
                req.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            } else {
                req.deny();
            }
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_FILE_CHOOSER && fileCallback != null) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null) {
                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
            fileCallback.onReceiveValue(result);
            fileCallback = null;
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        SpeechService.setEventSink(this);
        if (playerCore != null) {
            playerCore.setListener(coreListener);
            if (controlBar != null) controlBar.render(playerCore.snapshot());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
    }

    @Override
    protected void onRestoreInstanceState(Bundle savedInstanceState) {
        super.onRestoreInstanceState(savedInstanceState);
        if (webView != null) webView.restoreState(savedInstanceState);
    }

    @Override
    protected void onDestroy() {
        SpeechService.setEventSink(null);
        if (playerCore != null) playerCore.setListener(null);
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}

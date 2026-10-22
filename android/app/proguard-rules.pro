# DogEar release rules.
# The JS bridge is reached reflectively by the WebView: its
# @JavascriptInterface methods must survive minification by name.
-keep class app.getdogear.DogEarJsBridge { *; }
-keepclassmembers class app.getdogear.DogEarJsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
# Our own components are referenced from the manifest / intents.
-keep class app.getdogear.MainActivity { *; }
-keep class app.getdogear.SpeechService { *; }

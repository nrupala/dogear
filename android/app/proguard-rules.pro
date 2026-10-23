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
# App-first scaffolding (beta.5): the state machine and its ports
# are reached from the kept classes above; kept by name as well so
# the release build's shape never depends on reachability analysis.
-keep class app.getdogear.PlayerCore { *; }
-keep class app.getdogear.PlayerCoreProvider { *; }
-keep class app.getdogear.NativeControlBar { *; }
-keep class app.getdogear.MarksStore { *; }
-keep class app.getdogear.VoiceCapture { *; }

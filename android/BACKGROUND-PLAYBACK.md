# DogEar background playback — design note (2026-10-21)

**Defect (owner-reported, v1.0.1 on his phone):** reading stops when the app
is minimized. Audible / Evie / PocketBook / Apple Books read on; DogEar must too.

## Why it stops — the mechanism, from our own code

The web reader (reader-core 0.2.0, pinned) speaks through the Web Speech API
(`window.speechSynthesis`) inside Chrome's TWA renderer. The engine's own
source names the platform behaviour: on a hidden page an utterance error
"means the OS suspended speech" — and the engine's defence is to keep the
place and stop. Chrome freezes/throttles a backgrounded TWA page; there is
no web-layer setting that keeps `speechSynthesis` alive in a frozen page.
The Media Session API alone does not change this: it decorates media the
page is *already playing* — it does not keep a frozen page's speech engine
running, and a TWA holds no native playback service of its own. **Route (b),
pure-TWA + Media Session, is therefore discarded**: the missing piece is not
metadata or controls, it is a playback process that survives the page.

## The route taken — (a) WebView shell + native foreground service

Real audiobook apps read through a native playback service. DogEar adopts
the same shape:

- **Shell:** the TWA `LauncherActivity` is replaced as the entry point by
  our own `MainActivity` hosting a full-screen WebView on
  `https://app.getdogear.app/`. The web app stays the library, the UI, and
  the place-keeper — unchanged in a plain browser.
- **Bridge:** the WebView exposes `window.DogEarNative` (a
  `@JavascriptInterface`). The web layer installs a **speechSynthesis
  transport shim** (`native-bridge.js`) — only when that interface exists.
  reader-core reads `window.speechSynthesis` when a reader is created, so
  with the shim installed the *pinned, untouched* engine speaks through
  the shim: chunking, highlighting, place persistence (localStorage) and
  the app's speech watchdog all keep working exactly as written, in both
  worlds. In a browser the shim never installs and behaviour is identical
  to today.
- **Service:** `SpeechService`, a foreground service
  (`mediaPlayback` type) owning the **device's own** Android
  `TextToSpeech` engine — the device's voices, on-device, nothing
  recorded, nothing uploaded. It speaks one chunk at a time (the shim
  serializes exactly like the Web Speech queue does for the engine) and
  reports utterance start/end/error back into the page, which is what
  advances the engine's position — so the place on screen, the place in
  localStorage, and the voice can never drift apart.
- **Controls:** a media-style notification + lock-screen controls via a
  MediaSession (play/pause, next/previous chunk, stop). Notification
  actions route *through the engine* (the page's reader toggles), so the
  UI state and the voice stay one thing; the service also stops the voice
  immediately on pause as a belt-and-braces measure, and can re-speak the
  current chunk if the page is unreachable.
- **Audio focus:** the service holds audio focus while reading; a call or
  another app taking focus pauses the voice, and regaining focus resumes
  the current chunk. A partial wake lock is held while speaking so
  screen-off reading continues.

## Protocol (web ↔ native)

JS → native (`window.DogEarNative`):
`speak(id, text, rate, lang)` · `pausePlayback()` · `resumePlayback()` ·
`stopPlayback()` (session end) · `skipCurrent()` (stop this chunk, no
callback — the shim fires the chunk's end itself for "next";
re-speak for "previous") · `setNowPlaying(title)`.

Native → JS (`window.__dogearSpeechEvent(json)`):
`{t:'start'|'end'|'error', id}` utterance lifecycle ·
`{t:'control', action:'playpause'|'next'|'prev'|'stop'}` from the
notification / lock screen / media buttons.

Shim semantics mirror Chrome's: `speaking` is true from `speak()` until
the end event; `paused` reflects `pause()`; pause stops the device voice
mid-chunk and resume re-speaks the *current* chunk from its start (Android
TTS has no mid-utterance pause — the chunk is ≤240 chars, so the repeat
is a sentence or two, the same behaviour Evie-class readers exhibit).

## What changes, plainly

- The app **gives up the pure-TWA property**: DogEar is no longer "a
  website Chrome displays" but a small native app whose screens are the
  web app. Consequences: no dependence on Chrome being present/current;
  the Digital Asset Links verification is no longer what makes it
  full-screen (its own activity is); distribution stays the same APK/AAB.
- **For Play:** a WebView app with real native functionality (background
  audiobook playback, media controls) is a stronger store citizen than a
  bare TWA; the foreground-service + media permissions
  (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`,
  `POST_NOTIFICATIONS`, `WAKE_LOCK`) must be declared in the listing's
  permissions declarations at submission time. Nothing about the web
  app's own listing story changes.
- Samsung One UI app-sleep can still kill background apps the user never
  opens; the release notes for owner testing carry the standard guidance
  (Battery → set DogEar to Unrestricted) in case his phone needs it.

## Spike → build

The spike is the production code path, not a throwaway: the shell
injects the shim from an APK asset when the served page did not load it
itself (same file, two deliveries — the web app also ships
`native-bridge.js` from source for the day the site deploy carries it;
the shell checks a flag and never double-installs). Emulator proof
(API 36): start reading → Home → position keeps advancing for minutes
with the activity backgrounded → screen off → still reading →
notification pause/resume → return to the app with the place where the
voice is. Only on that evidence does the CI pre-release get cut.

# DogEar APK launch crash — root cause and fix (2026-10-21)

**Status: FIXED AND PROVEN IN AN EMULATOR.** v1 crashed on launch (the owner's
phone: dark screen, then Android's "closed because this app has a bug" dialog).
v2 (versionCode 2 / versionName "1.0.1") launches to the DogEar home UI in the
emulator, logcat clean. Both packages below are the fixed build.

## The crash, verbatim (v1 APK, Android emulator, API 36, 2026-10-21)

Full excerpt saved beside this note: `crashfix-logcat-v1-crash-excerpt.txt`.
The decisive lines:

```
10-21 18:00:49.605  2335  2335 E AndroidRuntime: FATAL EXCEPTION: main
10-21 18:00:49.605  2335  2335 E AndroidRuntime: Process: app.getdogear, PID: 2335
10-21 18:00:49.605  2335  2335 E AndroidRuntime: java.lang.RuntimeException: Unable to get provider androidx.startup.InitializationProvider: androidx.startup.StartupException: androidx.startup.StartupException: java.lang.IllegalStateException: ProcessLifecycleInitializer cannot be initialized lazily.
10-21 18:00:49.605  2335  2335 E AndroidRuntime: Please ensure that you have:
10-21 18:00:49.605  2335  2335 E AndroidRuntime: <meta-data
10-21 18:00:49.605  2335  2335 E AndroidRuntime:     android:name='androidx.lifecycle.ProcessLifecycleInitializer'
10-21 18:00:49.605  2335  2335 E AndroidRuntime:     android:value='androidx.startup' />
10-21 18:00:49.605  2335  2335 E AndroidRuntime: under InitializationProvider in your AndroidManifest.xml
10-21 18:00:49.605  2335  2335 E AndroidRuntime: 	at android.app.ActivityThread.installProvider(ActivityThread.java:8647)
...
10-21 18:00:49.605  2335  2335 E AndroidRuntime: Caused by: java.lang.IllegalStateException: ProcessLifecycleInitializer cannot be initialized lazily.
10-21 18:00:49.605  2335  2335 E AndroidRuntime: 	at androidx.lifecycle.ProcessLifecycleInitializer.create(ProcessLifecycleInitializer.java:38)
```

## Root cause, in plain words

Four AndroidX libraries each declare the same `androidx.startup.InitializationProvider`
in their manifests, each contributing a different `<meta-data>` initializer entry
(emoji2, lifecycle-process, profileinstaller, startup-runtime). A correct manifest
merge UNIONS those entries under one provider.

The v1 manual pipeline's merger (`manual/merge_manifest.py`) deduplicated
application elements by `android:name` — first provider wins, the rest were
silently dropped. The built v1 manifest kept only the EmojiCompat entry and lost
`androidx.lifecycle.ProcessLifecycleInitializer` (verified directly in the v1
APK: exactly 1 initializer entry present).

At launch, AndroidX Startup discovered EmojiCompatInitializer, which depends on
ProcessLifecycleInitializer; that initializer was not in the discovered set, so
AppInitializer threw `IllegalStateException` while the provider was being
installed — before any activity could start. The process died during
application bind: dark splash, then the system crash dialog. Every static check
(apksigner, badging, zipalign, resource tables) passed because nothing about the
APK was malformed — it was *incompletely merged*. This was a manual-pipeline
merger defect, not an app defect and not a web-app defect.

## What changed in the build

- v2 was built with the **real Gradle pipeline** (AGP 8.9.1, Gradle 8.11.1) from
  the existing Bubblewrap project (`android/twa/`), on the owner's laptop
  (JDK 17 + Android SDK), so AGP's manifest merger produced the manifest.
  The v2 APK's merged manifest carries all three initializer entries
  (EmojiCompat, **ProcessLifecycleInitializer**, ProfileInstaller) — verified
  with `aapt2 dump xmltree` on the shipped file.
- The interactive Bubblewrap CLI itself was not used for the final build: its
  prompts (manifest-change confirm, `update`'s version prompt, keystore
  password) cannot be driven reliably over non-TTY stdin. The deterministic
  equivalent of exactly what the CLI does was run instead: `gradlew
  assembleRelease bundleRelease` → zipalign + apksigner for the APK, jarsigner
  for the AAB. Keystore passwords were supplied via password files, never
  printed.
- **minSdk raised 21 → 24**: the current androidbrowserhelper (2.7.4, resolved
  by Gradle) declares minSdk 24 and AGP's merger refuses anything lower. API 24
  is Android 7.0 (2016). targetSdk stays 36.
- The two bookkeeping URLs in the project (`webManifestUrl`, `fullScopeUrl`)
  point at the real `https://app.getdogear.app/` values instead of the
  loopback placeholders the original offline init baked in — the same values
  the manual build used.
- Version bumped on both packages: **versionCode 2 / versionName "1.0.1"**.
- Signing identity unchanged: cert SHA-256
  `95b84a3e0977ff25e3d1e7a07acb5092323fd45709c158eb716de1cd19957ff0`
  (CN=Nrupal Akolkar, OU=AIMLDS, O=2351485 Alberta Inc., C=CA), verified with
  apksigner on the delivered APK and matching the live assetlinks.json.
- The manual pipeline (`manual/`) is **superseded for release builds** by this
  Gradle route: its manifest merger does not implement union semantics for
  same-name components. Do not ship another manual-pipeline build without
  fixing `merge_manifest.py` to union children of same-name components (and
  re-proving in an emulator).

## Launch proof (v2)

- Emulator: Pixel 6 AVD, `system-images;android-36;google_apis;x86_64`, WHPX
  acceleration, on the owner's laptop; Chrome first-run completed, then the
  v2 APK was launched.
- **Screenshot: `crashfix-proof-v2.png`** (beside this note) — the DogEar home
  UI rendered full-screen in the TWA: "Hear your documents.", the
  "Add your document" button, "Your documents, on this device". The UI
  hierarchy dump independently contained "Hear your documents" and
  "Add your document".
- Logcat for the v2 launch: **0 FATAL EXCEPTION lines**; LauncherActivity
  displayed (+1s145ms); no `app.getdogear` crash. (The app process exits after
  handoff by design — the TWA content is hosted by Chrome; the top activity
  after launch was Chrome's TWA activity with the DogEar UI visible.)
- The web content shown is the live production site, as with v1 — the crash
  was never in the web app.

## Delivered artifacts (this directory)

| File | Bytes | SHA-256 |
|---|---|---|
| `dogear.apk` (v2) | 3,303,468 | `ff87f837c9f40c846d0ed61c1cdddf39f81a860284a0fab4e71a55b2be7d98dc` |
| `dogear.aab` (v2) | 3,382,553 | `8a2369d8f0c57d90b8fed9b3c796364086073ba74149d0b557c1cd2204518c32` |

AAB verification: `bundletool validate` exit 0; `jarsigner -verify` → "jar
verified"; bundle manifest shows versionCode 2 / versionName 1.0.1 /
minSdk 24 / targetSdk 36 / package `app.getdogear`.

## Build provenance

Build machine: LAPTOP-HTA1H418, workspace `C:\Users\Public\dogear-crashfix\`
(project copy in `build\twa`, full Gradle log in `build.log`, repro/proof
logcats `logcat-v1.txt` / `logcat-v2.txt` there). The sandbox VM cannot run
this build (no KVM; JVM networking is blocked by the sandbox egress policy).

# DogEar bundled app — the two-endpoint design (2026-10-22)

**Owner's architecture decision (2026-10-22 02:18 MDT):** *"Let the web
deploy get ready, because it can always be a backup. And pack it up —
bundle everything in this app as well. So it has two endpoints: its
local voice, its Whisper AI locally, and the second endpoint is the
web endpoint."*

## The two endpoints (designated pathways, defined content)

| Pathway | Carries | Never carries |
|---|---|---|
| **Local endpoint** — everything inside the APK | The full web app tree (UI + reader-core engine) as bundled assets; the native `SpeechService` (device TTS) for reading, foreground + background + screen-off; the Whisper voice pack (Whisper base.en, Transformers.js/ONNX) for Talk + ask-the-text; documents, library, reading places, licence state (all on-device storage) | Anything uploaded. Nothing leaves the device on this pathway. |
| **Web endpoint** — `https://app.getdogear.app` (the same tree, served by the Worker) | The browser product itself; from the app: `POST /api/import` (fetch + extract a public page by URL), `POST /api/verify-purchase` (the stateless purchase-verification seam), `POST /api/improvement-request` (the About form), the Stripe tip link (opened in the browser), and any app path the installed bundle does not carry (see fallthrough below) | Reading, listening, documents, the voice pack, licence checks. No document function depends on it. It is a backup and a set of seams — never the load-bearing wall. |

## How the bundle is served (origin preserved, same tree)

The shell serves the bundled tree under the app's **real origin**,
`https://app.getdogear.app`, via `WebViewAssetLoader` bound to that
domain with a path handler over the APK's `assets/web/` tree:

- **Why the real origin:** localStorage (the library + places), the
  service worker's scope, Cache Storage (the voice-pack cache), and
  every relative fetch in the tree are origin-keyed. Serving under
  the true origin means the tree runs *unchanged* — the bundle is
  packaging, not a fork. The staging tool (`android/tools/
  bundle_web.py`) verifies every bundled file's sha256 against the
  gated build's own manifest (`dist/build-manifest.json` of worker
  `2bb61b11e18c…`, the certified 2026-10-22 deploy), and CI restages
  from the live endpoints against the committed
  `android/bundle-manifest.json`, failing closed on any mismatch.
- **Handler parity with the Worker:** the path handler mirrors
  `serveAsset()` — same route set, same content types, the identical
  CSP string on HTML, `no-cache` on HTML/`sw.js`/manifest, the
  immutable year-long cache header on `/pack/v1/*`. Trailing slashes
  normalize the same way; dot segments are refused.
- **Fallthrough = the backup pathway, literally:** a path the bundle
  does not carry returns *no* local response, and the WebView loads
  it from the live web endpoint. A newer web route reaches an older
  installed app when the phone is online; offline, that route simply
  isn't there. Bundled paths are a snapshot: they update on the app
  release cadence, not the web deploy cadence.
- **Service worker:** it registers and runs as on the web (the shell
  routes service-worker fetches through the same handler). Its
  network-first navigation becomes, in effect, bundle-first; its
  `/pack/` cache-first rule reads the pack cache the app fills (see
  the one named inefficiency below). `/api/*` and non-GET requests
  are never intercepted — they ride the web endpoint.
- **The speech bridge:** unchanged. `native-bridge.js` is part of
  the tree (loaded by `index.html`); the shell's asset-injection
  remains as a fallback and never double-installs.

## The Whisper pack: in the APK (decision + numbers)

The owner's words — "bundle everything in this app" — decide it:
**the pack ships inside the APK/AAB**, not as a first-run download.

- Bundled asset tree: **46 files, 116,932,575 bytes** — the pack is
  18 files / 114,221,609 bytes of that; the entire app shell is
  2,710,966 bytes. (Measured APK/AAB sizes are recorded with the
  beta.2 proof; the beta.1 APK was 3,275,459 bytes, so expect
  ≈118–121 MB.)
- The rejected alternative (first-run download into app storage)
  would make the "offline" promise conditional on a 114 MB online
  first run — the exact dependence the owner removed. Its one
  advantage, smaller updates, is noted: until Play asset delivery
  is adopted at the store step, an app update re-carries the pack.
- **The one named inefficiency:** the web tree decides the pack is
  "on this device" by reading its Cache Storage, which the in-app
  download fills after sha-verifying every file. In the bundle that
  one-time in-app "download" still runs — served from the bundled
  bytes at local speed, fully offline — and fills the cache with a
  second on-device copy (~114 MB of app storage). Removing it
  belongs to a future *web-tree* change (treat an asset-served pack
  as present); the shell does not fake the cache or fork the check.

## The offline contract

With the network killed, in the bundled app: cold open ✓ · library
and places ✓ · import by file or pasted text ✓ · Listen,
foreground + minimized + screen-off ✓ · Talk + ask-the-text ✓
(device voices + on-device Whisper; the mic path is the shell's new
`RECORD_AUDIO` plumbing) · licence paste + verification ✓
(on-device Ed25519) · meter ✓ (on-device).
Online-only, by design, and each is a web-endpoint seam: import by
URL (`/api/import` fetches a remote page — inherently online),
purchase verification (`/api/verify-purchase` — entitlement stays
device-held while it's unreachable, exactly as the seam was
designed), improvement requests (the form says it sends),
the tip link (opens the browser).

## What could not be preserved from the served model — named

1. **Instant web fixes to bundled paths.** The served app updates
   the moment the Worker deploys; the bundle updates when the app
   updates. The fallthrough above softens this for *new* paths
   only. This is the price of self-containment, taken knowingly.
2. **The pack cache duplication** described above (~114 MB extra
   device storage after the one-time in-app pack step).
3. **WebView variance.** Rendering/transcription run on the
   device's WebView build, as the shell already did — not on
   Chrome proper. (Emulator proof: API 35 WebView.)
4. `/.well-known/assetlinks.json` is bundled for tree fidelity but
   plays no role inside the app; Digital Asset Links govern the
   browser/TWA surface, not the shell.

# Codetopo Profile — DogEar (nrupala/dogear)

**What this is.** The agent-facing map of this repository, generated with
Codetopo 0.9.1 (local engine, `~/.cargo/bin/codetopo`) so an arriving agent
can see the machine — topology, trust boundaries, money surface — before it
submits or changes anything. Read this first; the graph snapshot beside it
(`snapshot.json`, `stats.json`) is the measured evidence.

- **Repo:** nrupala/dogear (public)
- **Commit profiled:** `6f715a9e675c6cf39bf6f7281399a8ca5ed6dedb` (main)
- **Engine:** codetopo 0.9.1 + full-language program (engine built from codetopo main `d71509d1` — all sixteen program extractors merged) · index run 2026-11-19
- **Graph:** 63 files walked · 0 failed · 17,095 nodes · 68,151 edges · audit chain valid (3 entries, head `042535b2…45ab`)
- **Nodes by kind:** external 8,899 · method 4,537 · function 1,906 · variable 838 · class 766 · file 63 · module 63 · doc 13 · interface 8 · package 2
- **Edges by kind:** calls 24,744 · defines 16,763 · reads 13,587 · contains 8,194 · writes 4,295 · inherits 510 · imports 51 · implements 7

## Coverage honesty

**Re-profiled 2026-11-19** with the full-language engine (Codetopo extractor program, 2026-11-18 ruling): every language this repo is written in is now extracted at symbol level. First profile: 2026-11-18 (Codetopo 0.9.1).

Codetopo now extracts every language in the full-language program (Rust, TypeScript/JavaScript, Python, Kotlin, C, Java, Go, Shell, C++, Swift, Ruby, R, Julia, C#, PHP, Scala, Haskell, Elixir, Lua), plus Markdown as Doc nodes. The JavaScript web core and the Python build/deploy tools are extracted as before, and the Android shell named as the residual in the first profile is now in the graph at full symbol level: the 13 Java files under `android/app/src/main/java/app/getdogear/` (`MainActivity`, `PlayerCore`, `SpeechService`, `DogEarJsBridge`, `LauncherActivity` and siblings, plus `PlayerCoreTest` — Java extractor, program PR #156). HTML/CSS/XML/Gradle/properties files are not parsed into the graph; read them directly.
## Topology

One read-aloud reader shipped in three forms from this one repository
(README): an embeddable web reader, browser extensions, and an Android app.

- **Web reader core (JS, extracted):** the bundled app under
  `android/app/src/main/assets/web/` — `app.js` (shell), `reader-core.js`
  (reading engine), `speaker.js` / `voicepack.js` / `voicefx.js` /
  `ttspack.js` (speech), `ingest.js` (document intake), `retrieval.js`,
  `selfmodel.js`, `meter.js` (free-minutes metering), `config.js`
  (configuration constants), `sw.js` (service worker), and the vendored
  libraries under `vendor/` (pdf/mammoth/jszip/nacl builds). The same core
  ships standalone as `reader/dogear.js` and `site/dogear.js`.
- **Browser extension (JS, extracted):** `extension/` — `background.js`,
  `content.js`, `popup.js`, with a vendored copy of the reader core under
  `extension/vendor/reader-core/`; manifests for Chrome/Edge and Firefox.
- **Android app (Java shell — residual, see Coverage):** a WebView/TWA
  shell (`MainActivity`, `LauncherActivity`) hosting the bundled web app,
  with a native bridge (`DogEarJsBridge`, `dogear-native-bridge.js`),
  native playback (`PlayerCore`, `PlayerCoreProvider`, `SpeechService`,
  `DelegationService`) and a marks store (`MarksStore`). The web assets
  are bundled by `android/tools/bundle_web.py`.
- **Build/deploy tools (Python, extracted):** `tools/deploy-worker.py`
  and `tools/build-worker-block.py` (the site/worker deploy path),
  `extension/tools/build.py` + `extension/tools/verify.py` (extension
  packaging and verification).

## Trust boundaries

- **Licence keys are Ed25519-signed tokens** (`licence.js`): the payload
  is verified against the licence signing **public** key embedded in the
  client. The signing **private** key never ships — per the module header
  it lives with the issuer only. Verification is fail-closed and names
  why a licence failed. Licence state is held client-side
  (`window.DogEarLicence`; names only: `LICENCE_KEY`, `licencePayload`).
- **Play purchase verification is a named open seam:** after a purchase
  the client POSTs the purchase token (name: `purchaseToken`) to the
  worker's `/api/verify-purchase` endpoint. The `billing.js` header
  states plainly that this endpoint is stateless today (validates shape,
  stores nothing) because real verification needs a Play Developer API
  credential that does not exist yet — entitlement is therefore
  client-side until that credential lands. Do not present it as
  server-verified.
- **No credential values live in the extracted code.** Configuration is
  by named constants in `config.js` (names only: `STRIPE_TIP_LINK`,
  `PLAY_BILLING_METHOD`, `SKUS`, `UNLOCK_PRICE_LABEL`,
  `FREE_MINUTES_PER_DAY`, `VOICE_PACK_BASE`). The native bridge
  (`DogEarJsBridge` / `native-bridge.js`) is the boundary between the web
  core and Android capabilities — treat any change to it as a
  trust-boundary change.
- **Blast radius:** `reader-core.js` and `app.js` are the hubs of the
  call graph (23,647 call edges across the pack); the vendored reader
  core inside `extension/` must stay in step with the main core.

## Money surface

Two deliberate money paths, both client-side seams — no payment SDK and
no card handling anywhere in this repo:

- **Play Billing unlock + tips** (`billing.js`, exposed as
  `window.DogEarBilling`): runs only inside the Play-installed app via
  the Digital Goods API — `getDetails` (prices from Play itself),
  `PaymentRequest.show()` (Play's own buy sheet), `acknowledge` for the
  one-time unlock, `consume` for tips, `listPurchases` to restore.
  Entry points by name: `billing.buyUnlock`, `billing.buyTip`. On the
  open web the module reports itself unavailable and the app shows no
  buy buttons. The unlock flag is a local storage key (name only:
  `dogearapp:unlock:v1` in the source). See the verification-seam risk
  named under Trust boundaries.
- **Stripe tip link** (`config.js` name: `STRIPE_TIP_LINK`): a hosted
  Stripe payment link the client opens for tips (`billing` name:
  `tipStripe` / `hasStripe`). No Stripe secret key, webhook handler or
  checkout-session code exists in this repo — the money itself moves on
  Stripe's hosted page and in Play, never through code here.

Greps used for this section and Trust boundaries (names only, no values
copied): `stripe|paddle|secret|token|api_key|auth|password|billing|checkout|webhook`
over the JS/Python/Markdown/JSON sources.

## How an agent should approach

1. Read `README.md`, then this profile, then the snapshot.
2. Use `codetopo` queries against `graph.db`/the snapshot (descendants,
   blast-radius, symbol) before editing — especially around
   `reader-core.js`, `billing.js` and `licence.js`.
3. For the Android Java shell, read the sources directly — the graph
   cannot see them yet (see Coverage honesty). Do not claim graph
   evidence for Java behaviour.
4. Never add credential values, account identifiers or key material to
   any file here — names and paths only. The licence signing private key
   must never enter this repo.
5. Regenerate this profile (below) whenever the code changes.

## Regeneration

`docs/codetopo-profile/refresh.sh` (in this pack) re-downloads the repo
at a named ref, re-runs the index, and rewrites `snapshot.json`,
`stats.json` and the header block inputs of this profile. Regenerate at
every release / material change to the reader core, billing or licence
modules.

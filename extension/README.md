# DogEar — browser extension (Phase 1)

DogEar for the browser: one click and the page is read aloud in **your
computer's own voice** — the operating system's built-in voices, through
the browser's Web Speech `speechSynthesis`. Nothing is uploaded, there
are no trackers, and no account is needed to start.

> Document in, place kept, resume anywhere.

Phase 1 is the owner's design from `~/workspace/dogear/EXTENSION-SCOPE.md`:
a new shell on the canonical read-aloud engine, **reader-core**
([nrupala/reader-core](https://github.com/nrupala/reader-core), Apache-2.0),
**pinned at v0.2.0** — the same pin the DogEar web app carries. Shells pin
reader-core; they never fork it. The pinned bytes live in
`vendor/reader-core/` with their `PIN.json` hash record, and
`tools/verify.py` fails the build if a single byte drifts.

## What it does

- **Read this page** — toolbar popup, right-click menu, or `Alt+Shift+R`.
  Reader-core finds the article, wraps its sentences, and reads with
  highlighting, speed control, pause/resume and stop. Your place is kept
  per page: leave and come back, and reading resumes where it stopped.
- **Read selection** — highlight a passage, right-click, and just that
  passage is read.
- **On-device voices first** — reader-core's standing privacy rule
  (release-gate finding F11): a network voice would send the text being
  read to the browser vendor's servers, so the engine prefers voices
  that live on your device. To change the voice, change your system's
  default voice in your OS settings.
- **Metering, honestly** — listening counts toward the same **600 free
  minutes a month** every DogEar surface shares; the one-time unlock
  (US$24.99) in the DogEar app removes the limit. The device's voices
  are never sold — the charge is for heavy use of the app.

## Permissions — narrow on purpose

`activeTab` (only the tab you invoke DogEar on, only when you invoke
it), `scripting` (to place the reader on that tab), `contextMenus`,
`storage` (the meter and settings). No host permissions, no background
page scraping — reading starts only on your click. There are no network
calls anywhere in the shell code; `tools/verify.py` enforces that.

## Known Phase 1 boundaries (recorded, not hidden)

- **Shared meter/unlock bridge is owed plumbing.** The 600-minute
  allowance is enforced inside the extension today; the bridge that
  shares one meter and one unlock state between the extension and the
  web app is the one genuine piece of new plumbing the scope names as a
  dependency. Until it lands, heavy use across both surfaces is counted
  per surface.
- **Voice choice follows the pin.** An in-popup voice picker needs a
  reader-core option the pinned v0.2.0 does not expose; per the pin
  discipline the shell does not fork the engine to fake one. The popup
  lists your computer's voices and the engine's on-device rule is
  stated plainly. The picker arrives with a reader-core pin upgrade.
- **Phase 2 (not in this build)** adds the Whisper pack inside the
  extension — voice control and ask-the-text, on-device — once the pack
  clears its gate in the web app. The extension inherits the pack; it
  does not debut it.

## Builds — one tree, three stores

`tools/build.py` assembles all three store packages from this one tree
(and runs in GitHub Actions — see `.github/workflows/extension.yml`;
artifacts land on the workflow run):

- `dogear-extension-chrome-<version>.zip` — Chrome Web Store
- `dogear-extension-edge-<version>.zip` — Microsoft Edge Add-ons (same
  Chromium build)
- `dogear-extension-firefox-<version>.zip` — Firefox Add-ons
  (`manifest.firefox.json`: gecko id `dogear@getdogear.app`, event-page
  background form)

Verify before you ship: `python3 tools/verify.py` (tree) and
`python3 tools/verify.py --zips` (after a build). Smoke test:
`cd tests && npm ci && node smoke.test.mjs` (jsdom; drives the real
payload through the production message protocol).

Load unpacked for a manual check: Chrome/Edge → Extensions → Developer
mode → *Load unpacked* → this directory. Firefox → `about:debugging` →
*This Firefox* → *Load Temporary Add-on* → `manifest.firefox.json`.

## Safari — the owed step, recorded honestly

Safari is **not** in this pack. A Safari web extension is produced by
converting this same source with Xcode's `safari-web-extension-converter`
and shipping it inside a macOS app wrapper through the Apple Developer
Program — a Mac step. This fleet has no Mac, so Safari waits for one;
the source is written to convert cleanly (standard MV3, no
Chromium-only APIs in the shell) when that day comes.

## About

DogEar by **2351485 ALBERTA INC. (AIMLDS)** — [getdogear.app](https://getdogear.app).
Reader-core is Apache-2.0 (see its license header in `vendor/reader-core/`).

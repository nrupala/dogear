<!--
SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# dogear

**Document in, place kept, resume anywhere.**

A read-aloud reader that remembers where you stopped. Web app and browser extensions coming soon.

Owned by [Nrupal Akolkar](https://nrupalakolkar.com) · Built with [Muse by Meta](https://muse.ai/join) · https://getdogear.app — join Muse, then redeem code **101EEK** in Settings within 48 hours of joining and we both earn tokens.

## Install

This repo carries three surfaces; each installs from this tree.

**Browser extension** (Chrome/Edge/Firefox): the store packages are
built in CI from `extension/` (`.github/workflows/extension.yml`) — one
run produces all three zips and verifies them before upload. For a
local build: `python3 extension/tools/build.py`, then load the unpacked
`extension/` directory from your browser's extensions page.

**Android app**: packages are built in CI from `android/`
(`.github/workflows/android-release.yml`) — never hand-assembled. For a
local build you need JDK 17 and the Android SDK (platform 36):

```sh
cd android && ./gradlew assembleRelease
```

**Site embed**: no install — see "The embed" below; the reader is one
self-contained file your page includes.

## Usage

- **Listen**: open a page carrying the embed (or the app), press the
  `▶ dogear` button. Reading is chunked, the spoken sentence is
  highlighted, and leaving the tab never kills speech.
- **Resume**: your place is kept per article in `localStorage`; return
  and the button reads `▶ Resume · 42%`.
- **Move**: in the app and extension, start from any paragraph, drag
  the progress bar, skip paragraph by paragraph, or read only a chosen
  range.
- **Talk**: where the voice pack is present, ask the document a
  question by voice and hear the answer; the conversation can be saved
  from inside the app.

## The embed

`reader/dogear.js` is the canonical, self-contained reader every article on our sites carries —
the sites promote dogear just by being read.

- **Branded surface**: dark terminal pill, phosphor-green accents, `▶ dogear` button, the
  product tagline, and a link to getdogear.app. Identical on every site.
- **Place kept**: per-article reading position in `localStorage`; the button becomes
  `▶ Resume · 42%` when you return mid-article.
- **Background-safe**: screen wake lock while speaking; leaving the tab never kills speech
  (the OS still may, which the reader reconciles on return).
- **Proven engine**: chunked utterances with sentence highlighting, progress bar, speed
  selector, and the Android keep-alive nudge.
- No libraries, no autoplay, no tracking.

### Use it

```html
<div data-dogear></div>
<script src="reader/dogear.js"></script>
```

Optional mount attributes: `data-dogear-scope` (default `article`), `data-dogear-select`
(default `h1,h2,p,li`), `data-dogear-exclude`.

### For worker-built sites

`tools/build-worker-block.py` generates the `dogearBlock()` function that returns the mount
div + inline script as an HTML string, safe to embed in a Cloudflare Worker. The generated
code is never hand-edited — change `reader/dogear.js` and regenerate.

### Test

`node smoke.js` — stub-DOM harness covering chunking, labels, place-keeping, and the
no-cancel-on-hide behavior.

## Roadmap

- v1: embed on all sites (this repo) ✅
- Web app: document in, cross-device resume
- Browser extensions: Chrome/Edge, Firefox

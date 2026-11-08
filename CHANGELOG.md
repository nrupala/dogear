<!--
SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.

SPDX-License-Identifier: AGPL-3.0-or-later
-->

# Changelog — DogEar browser extension

All notable changes to the DogEar extension (`extension-src/`) are
recorded here, in [Keep a Changelog](https://keepachangelog.com)
format. This file is the extension's update chain: **every version
bump adds its entry here, in the same commit as the bump** — the
store listing's "what's new", the manifest version, and this file
must never disagree.

(The DogEar app's history lives in `../BETA-RELEASE-NOTES.md`; this
file covers the browser extension only.)

## [Unreleased]

- **Free allowance is now daily** (owner's ruling, 2026-11-07):
  60 free listening minutes per local day, renewing at midnight —
  replacing 600 minutes per month. The meter key is the local
  calendar day; stored monthly totals are not converted (the
  daily map keeps only today's key, older keys drop on write).
  Popup and in-page meter lines state the daily figures.

## [1.1.0] — 2026-11-07 (in development, not yet submitted)

Paragraph navigation, on the reader-core 0.3.0 engine (the same
engine build as the app):

- Right-click menu: "Read from here with DogEar" (starts at the
  paragraph you right-clicked, once DogEar has run on the page)
  and "Read this only with DogEar" (reads just the selection).
- Popup player: Previous / Next paragraph buttons, a seek bar,
  and a position line ("Paragraph X of Y").
- Follow-along: the spoken sentence is highlighted and the page
  scrolls to it; the paragraph being read is marked.
- Voice picker in the popup: DogEar's voice leads; the system
  default and the device's other on-device voices are in the
  same list. The choice is remembered and switching mid-page
  keeps the reading place.
- Store publication remains blocked by the Web Store limit
  case — this version is built and proven locally only.

## [1.0.0] — 2026-10-30

First store release (Chrome Web Store, Microsoft Edge Add-ons,
Firefox AMO), as remediated after the Gemini third-party pre-store
check of 2026-10-30 (see `../store/GEMINI-CHECK-2026-10-30.md`).

### Added

- Read the current page — or just the selected passage — aloud from
  the toolbar popup, the right-click menu, or `Alt+Shift+R`. The
  reading bar mounts on the page with play/pause, stop, speed
  control, progress, and sentence highlighting.
- **On-device voices only, enforced in the engine.** DogEar reads
  with a voice that lives on your device and never sends text
  anywhere: the reader engine (reader-core 0.2.1) never selects a
  network voice and never falls back to the browser's default voice.
  If the device has no on-device voice, reading does not start and
  the bar says so plainly.
- **Place memory.** Your place on each page is kept and offered
  again on return. Place records live in the extension's own
  `chrome.storage.local`, isolated from page scripts; a record left
  in a page's `localStorage` by an earlier build is migrated once
  and removed from the page.
- **Free allowance, stated as implemented: 600 listening minutes
  per month**, metered on the device only, renewing on the first of
  each month. When the month's allowance is used up, reading stops
  and the bar says when it renews. No purchase is offered inside the
  extension, and no external unlock is claimed to apply to it.
- Popup showing this month's listening meter and the device's
  voices, marking which are on-device (network voices are listed as
  never used).
- Icons at 16/32/48/128 (page with a folded dog-ear corner and a
  play mark, in the product's indigo/aquamarine).

### Security

- Permissions are exactly `activeTab`, `scripting`, `contextMenus`,
  `storage` — no host permissions, no network code anywhere in the
  extension.
- Runtime messages between popup, background worker, and content
  script are validated: sender must be this extension, and commands
  must be on a fixed allowlist.
- Store packages are built from a runtime-file allowlist
  (`tools/build.py`); `tools/verify.py --zips` fails on any
  unexpected file in a package.

### Notes

- The Firefox package keeps the permanent add-on ID
  `dogear@getdogear.app` (the product's own domain).
- The cross-surface unlock bridge (DogEar app purchase lifting this
  extension's monthly cap) is **not** built as of 1.0.0; the
  extension's copy says nothing that depends on it.

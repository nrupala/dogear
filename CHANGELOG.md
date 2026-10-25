# Changelog

All notable changes to dogear are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

## [1.1.0] - 2026-10-24

Web 1.6.0 (certified worker sha256 83293d98c8f75550...) bundled via the
committed routes-only bundle-manifest (sha-verified against the live,
certified bytes at build time). Ships as a RELEASE CANDIDATE:
graduation to final follows the owner's phone verdict + a clean soak.

### Added
- The app answers questions about itself by voice - what it is, what
  the controls do, how Talk works, the plan (600 free minutes a month;
  the one-time US$24.99 unlock) - composed from the product's live
  state, so the speech cannot drift from the product.
- Speech-completion watchdog: a stalled utterance is re-spoken from
  the cut point; every job is accounted (given / confirmed /
  recovered / lost) and a mismatch is a logged defect, never silent.
- Failures speak their cause and remedy (microphone blocked, no
  speech heard, pack missing, and twelve more classes); the bare
  "listening failed" is gone, guarded by a census test.
- Answers composed as units: lead, content, completion, next step.

### Fixed
- The transport wedge behind beta.5's failed press series: a speech
  cancel secretly held full Stop authority. Cancel is now voice-only
  by construction; the 25-cycle press series and the process-death
  Continue-at-the-pin proof pass on this build.
- Library rows were not tappable outside the small Open button
  (caught by the fresh-eyes walk); the row opens, the button seeks.

### Known limits
- After a permission revoke (which kills the process) and a
  relaunch, the player can rarely show "playing" while the page
  sits idle; Stop then Play revives from the saved place. A named
  soak item: fixed or re-accepted by name before "final".
- Server-side Play purchase verification activates when the Play
  Console credential is provisioned; until then entitlement is
  held on the device.
- Larger voice models (Small and up) remain capability-gated in
  the shelf, with the reason shown.


## [1.1.0-beta.4] - 2026-10-22

Web 1.4.0 (certified worker sha256 428daa2044e82cd1…) bundled via the
regenerated routes-only bundle-manifest (worker hash cross-checked).

### Fixed
- Talk never started in the shell: Chromium's WebView capture path
  requires MODIFY_AUDIO_SETTINGS alongside RECORD_AUDIO — the manifest
  now declares it (owner's phone, A/B-proven on the bench).
- Microphone errors blamed the user's permission for every failure
  class; the copy now names the real class (denied / busy / no mic /
  interrupted).
- The top control row was painted under the status bar and untappable
  (edge-to-edge insets ignored); MainActivity now applies decor-view
  insets.
- Voice models the in-app engine cannot safely run (Small / Medium /
  Large in the WASM runtime) were downloadable but could never load —
  the shelf now gates them with the reason until the native-inference
  phase lands. Silence transcriptions ([BLANK_AUDIO]) are no longer
  quoted back as speech.

### Added
- Battery-exemption flow: bridge state query + a one-time in-reader
  hint that opens the system setting (Samsung app-sleep can kill
  background reading; playback itself is proven on stock Android).
- `tools/bundle_web.py`: bundle variants are a first-class flag
  (`--routes-only` = shell-only, the beta.3/beta.4 shape); manifests
  are never hand-filtered.

### Notes
- Background legs (minimize / screen-off place advance) are now
  permanent release-proof legs, re-run on the shipped artifact.

## [1.1.0-beta.3] and earlier

- Licensed under AGPL-3.0 (portfolio license policy, owner decision 2026-10-11); canonical license text added as `LICENSE`.


### Added
- `CONTRIBUTING.md`: PR-flow discipline (draft PR → tests green → owner
  merges; no direct pushes to `main`; merge commits reference PR numbers;
  releases tagged `vX.Y.Z`), signed-deploys-only policy, and test instructions.
- `NOTICE`: attribution file ("Owned by Nrupal Akolkar · Built with Muse by Meta").

### Changed
- `tools/deploy-worker.py`: now DELEGATES to the site-integrity signed-deploy
  wrapper (`~/workspace/site-integrity/deploy_signed.py`). The old unsigned
  multipart module-upload path is deleted. The wrapper carries forward the
  live script's non-secret bindings and compatibility date, preserves
  server-side secrets, re-hashes the deployed bytes, and mints a signed ledger
  certificate.

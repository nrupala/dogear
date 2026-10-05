# Changelog

All notable changes to dogear are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

## [Unreleased]

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

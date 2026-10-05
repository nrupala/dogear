# Contributing to dogear

## PR flow (standing rule, 2026-10-05)

Direct pushes to `main` are retired. Every change lands through a pull request:

1. Branch from `main` head.
2. Open the PR as **draft**.
3. Tests green (see "Tests" below).
4. The owner merges; merge commits reference the PR number.
5. Releases are tagged `vX.Y.Z` after merge.

## Versioning

Semantic versioning. Every PR adds a `CHANGELOG.md` entry under
`## [Unreleased]`. The library's own version banner lives in the header
comment of `reader/dogear.js` (v1.0.5) — bump it in the same PR as the
functional change (patch = fix, minor = feature, major = breaking change).

## Deploys (signed only)

Worker deploys go through `tools/deploy-worker.py`, which delegates to the
site-integrity signed-deploy wrapper
(`~/workspace/site-integrity/deploy_signed.py`). There is no unsigned deploy
path: the wrapper carries forward the live script's non-secret bindings,
preserves server-side secrets, re-hashes the deployed bytes, and mints an
Ed25519 ledger certificate binding worker name + artifact SHA-256 + signer +
timestamp. Deploy only through this script. Never touch signing keys — the
wrapper handles them.

## Tests

- `node smoke.js` — stub-DOM harness covering chunking, labels, place-keeping,
  and the no-cancel-on-hide behavior. Must be green before merge.

## Repo conventions

- `reader/dogear.js` is the canonical source. Never hand-edit generated
  artifacts: change `reader/dogear.js` and regenerate with
  `python3 tools/build-worker-block.py`.
- Keep the embed self-contained: no libraries, no autoplay, no tracking.
- Attribution on new public-facing work:
  `Owned by Nrupal Akolkar · Built with Muse by Meta`.

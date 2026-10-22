# DogEar for Android

The Android package for **DogEar — hear your documents** (`app.getdogear.app`).
This is a Trusted Web Activity (TWA) generated with Bubblewrap: a thin,
signed Android shell that opens the DogEar web app full-screen. Package
`app.getdogear`.

## How releases are built

Releases are built **only in GitHub Actions** — never hand-assembled on a
local machine. Push a version tag (`v*`) and the
`Android release` workflow (`.github/workflows/android-release.yml` at the
repo root) runs `assembleRelease` + `bundleRelease`, signs both artifacts
with the release keystore (held in the `DOGEAR_*` repository secrets), checks
that the signer certificate matches the fingerprint in
`assetlinks.json`, validates the bundle with bundletool, and attaches
`dogear.apk` / `dogear.aab` to the GitHub release.

To install a test build: open the release, download **dogear.apk**, open it
on the phone, and install. A new build installs over the previous one in
place.

Signing identity (release keystore, kept in CI secrets + local custody —
never committed): certificate SHA-256
`95:B8:4A:3E:09:77:FF:25:E3:D1:E7:A0:7A:CB:50:92:32:3F:D4:57:09:C1:58:EB:71:6D:E1:CD:19:95:7F:F0`.

## The v1 lesson

v1.0.0 was assembled by a hand-rolled local pipeline whose manifest merger
silently dropped an AndroidX startup entry, so the app crashed on launch
while passing every static check. v1.0.1 is the same app built with the real
Gradle pipeline and proven to open in an emulator. Full record:
[`CRASH-FIX-NOTE.md`](CRASH-FIX-NOTE.md). Local hand-assembly of a release
package is out — if it isn't built by CI from this tree, it doesn't ship.

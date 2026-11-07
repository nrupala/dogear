#!/usr/bin/env python3
"""Verify the DogEar extension tree (and, with --zips, the built zips).

Checks, all hard failures:
  - both manifests parse, carry name + version, and agree on version;
  - permissions are exactly the narrow Phase 1 set on both manifests
    (activeTab, scripting, contextMenus, storage) — no host permissions;
  - every file a manifest or the background worker references exists;
  - the vendored reader-core bytes match vendor/reader-core/PIN.json
    (the pin is a pin: byte-identical, never forked);
  - no network surface in the shell code: no fetch / XHR / WebSocket /
    sendBeacon / remote script or image URLs (fabric doctrine — the
    extension must work if every external service vanished tonight);
  - with --zips: each built zip has manifest.json at its root, parses,
    and contains EXACTLY the runtime payload — the full allowlist incl.
    icons and the pinned engine, and no other file. An unexpected file
    in a zip is a hard failure (the job-scratch contamination class,
    Gemini pre-store BLOCK finding 2, 2026-10-30).
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
NARROW_PERMISSIONS = {"activeTab", "scripting", "contextMenus", "storage"}
NETWORK_TOKENS = ["fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon",
                  "http://", "https://"]
# The one allowed URL is the product's own homepage link in the popup.
ALLOWED_URL_FILES = {"popup.html", "popup.js"}

failures = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        failures.append(msg)


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    man = json.loads((ROOT / "manifest.json").read_text())
    man_ff = json.loads((ROOT / "manifest.firefox.json").read_text())
    check(man.get("manifest_version") == 3, "chromium manifest is MV3")
    check(man_ff.get("manifest_version") == 3, "firefox manifest is MV3")
    check(bool(man.get("name")) and bool(man.get("version")),
          "chromium manifest carries name + version")
    check(man.get("version") == man_ff.get("version"),
          "manifest versions agree")
    check(set(man.get("permissions", [])) == NARROW_PERMISSIONS,
          "chromium permissions are exactly the narrow set")
    check(set(man_ff.get("permissions", [])) == NARROW_PERMISSIONS,
          "firefox permissions are exactly the narrow set")
    check("host_permissions" not in man and "host_permissions" not in man_ff,
          "no host_permissions anywhere")
    gecko = (man_ff.get("browser_specific_settings") or {}).get("gecko") or {}
    check(bool(gecko.get("id")), "firefox manifest carries a gecko id")

    refs = set()
    for m in (man, man_ff):
        for size, path in (m.get("icons") or {}).items():
            refs.add(path)
        action = m.get("action") or {}
        if action.get("default_popup"):
            refs.add(action["default_popup"])
        bg = m.get("background") or {}
        if bg.get("service_worker"):
            refs.add(bg["service_worker"])
        for s in bg.get("scripts") or []:
            refs.add(s)
    # Files the background worker injects (see background.js).
    refs.update([
        "vendor/reader-core/reader-core.js",
        "vendor/reader-core/reader-core.css",
        "content.js",
        "bar.css",
    ])
    for rel in sorted(refs):
        check((ROOT / rel).is_file(), f"referenced file exists: {rel}")
        if rel.endswith(".png") and (ROOT / rel).is_file():
            # A 0-byte icon passed this gate in the tree once (the
            # original icon-16.png) and blocked the store submission;
            # existence is not validity.
            check((ROOT / rel).stat().st_size > 0,
                  f"referenced icon is non-empty: {rel}")

    pin = json.loads((ROOT / "vendor/reader-core/PIN.json").read_text())
    for fname, want in (pin.get("files") or {}).items():
        got = sha256(ROOT / "vendor/reader-core" / fname)
        check(got == want, f"pinned reader-core byte-identical: {fname}")

    shell_files = ["background.js", "content.js", "popup.js", "popup.html",
                   "bar.css", "popup.css"]
    for rel in shell_files:
        text = (ROOT / rel).read_text(errors="replace")
        bad = [t for t in NETWORK_TOKENS if t in text]
        if rel in ALLOWED_URL_FILES:
            bad = [t for t in bad if t not in ("http://", "https://")]
        check(not bad, f"no network surface in {rel}" +
              (f" (found {bad})" if bad else ""))

    if "--zips" in sys.argv:
        # The exact runtime payload every store zip must carry: the
        # per-flavour manifest at the root plus the allowlist that
        # tools/build.py stages. Anything more is contamination;
        # anything less is an incomplete package.
        expected = {
            "manifest.json",
            "background.js",
            "content.js",
            "popup.html",
            "popup.js",
            "popup.css",
            "bar.css",
            "icons/icon-16.png",
            "icons/icon-32.png",
            "icons/icon-48.png",
            "icons/icon-128.png",
            "vendor/reader-core/reader-core.js",
            "vendor/reader-core/reader-core.css",
        }
        version = man["version"]
        for name in ("chrome", "edge", "firefox"):
            zp = ROOT / "build" / f"dogear-extension-{name}-{version}.zip"
            check(zp.is_file(), f"zip exists: {zp.name}")
            if not zp.is_file():
                continue
            with zipfile.ZipFile(zp) as z:
                names = z.namelist()
                check("manifest.json" in names,
                      f"{name}: manifest.json at zip root")
                parsed = json.loads(z.read("manifest.json"))
                check(parsed.get("version") == version,
                      f"{name}: zip manifest version {version}")
                got = set(names)
                for need in sorted(expected):
                    check(need in got, f"{name}: zip contains {need}")
                extras = sorted(got - expected)
                check(not extras,
                      f"{name}: zip contains no unexpected files" +
                      (f" (found {extras})" if extras else ""))
                for icon in ("icons/icon-16.png", "icons/icon-32.png",
                             "icons/icon-48.png", "icons/icon-128.png"):
                    if icon in got:
                        check(len(z.read(icon)) > 0,
                              f"{name}: {icon} is a non-empty image")

    print("FAILURES: " + str(len(failures)))
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

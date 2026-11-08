# SPDX-FileCopyrightText: 2026 2351485 ALBERTA INC.
#
# SPDX-License-Identifier: AGPL-3.0-or-later

#!/usr/bin/env python3
"""Build the DogEar extension store zips from the one source tree.

One build produces all three store packages (the owner's CI doctrine —
the same script runs locally and in GitHub Actions):

  build/dogear-extension-chrome-<version>.zip   (manifest.json)
  build/dogear-extension-edge-<version>.zip     (same Chromium build)
  build/dogear-extension-firefox-<version>.zip  (manifest.firefox.json)

The payload is an ALLOWLIST (PAYLOAD_FILES): exactly the extension's
runtime files and nothing else. The previous build walked the tree and
shipped whatever it found, which swept job scratch (CI logs, helper
scripts, merge artifacts) into the store zips — Gemini pre-store BLOCK
finding 2, 2026-10-30. With an allowlist, a scratch file sitting in the
source root can never enter a zip again; a new runtime file must be
added to the list deliberately, in the same commit that adds the file.
tools/verify.py --zips independently enforces the same set.
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

# The complete runtime payload, relative to the source root. The
# manifest is staged separately per flavour (manifest.json at zip
# root), so neither manifest file appears here.
PAYLOAD_FILES = [
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
]


def stage(name, manifest_src):
    stage_dir = BUILD / f"stage-{name}"
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True)
    for rel in PAYLOAD_FILES:
        src = ROOT / rel
        if not src.is_file():
            raise SystemExit(f"payload file missing from tree: {rel}")
        dest = stage_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dest)
    shutil.copyfile(ROOT / manifest_src, stage_dir / "manifest.json")
    return stage_dir


def zip_dir(stage_dir, zip_path):
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for p in sorted(stage_dir.rglob("*")):
            if p.is_file():
                z.write(p, p.relative_to(stage_dir).as_posix())
    return zip_path


def main():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    version = manifest["version"]
    BUILD.mkdir(exist_ok=True)
    out = []
    for name, manifest_src in (
        ("chrome", "manifest.json"),
        ("edge", "manifest.json"),
        ("firefox", "manifest.firefox.json"),
    ):
        stage_dir = stage(name, manifest_src)
        zp = zip_dir(stage_dir, BUILD / f"dogear-extension-{name}-{version}.zip")
        out.append(zp)
        print(f"{zp.name}: {zp.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())

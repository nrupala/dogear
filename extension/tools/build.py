#!/usr/bin/env python3
"""Build the DogEar extension store zips from the one source tree.

One build produces all three store packages (the owner's CI doctrine —
the same script runs locally and in GitHub Actions):

  build/dogear-extension-chrome-<version>.zip   (manifest.json)
  build/dogear-extension-edge-<version>.zip     (same Chromium build)
  build/dogear-extension-firefox-<version>.zip  (manifest.firefox.json)

Each zip carries the manifest at its root, the payload files flat in the
extension layout, and nothing else: no tools, no tests, no README.
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"

EXCLUDE_DIRS = {"tools", "tests", "build", "__pycache__"}
EXCLUDE_FILES = {"README.md", ".gitignore"}


def payload_files():
    files = []
    for p in sorted(ROOT.rglob("*")):
        if not p.is_file():
            continue
        rel = p.relative_to(ROOT)
        if rel.parts[0] in EXCLUDE_DIRS:
            continue
        if rel.name in EXCLUDE_FILES:
            continue
        files.append(rel)
    return files


def stage(name, manifest_src):
    stage_dir = BUILD / f"stage-{name}"
    if stage_dir.exists():
        shutil.rmtree(stage_dir)
    stage_dir.mkdir(parents=True)
    for rel in payload_files():
        if rel.name in ("manifest.json", "manifest.firefox.json"):
            continue
        dest = stage_dir / rel
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / rel, dest)
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

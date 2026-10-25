#!/usr/bin/env python3
"""Stage DogEar's web app into the Android shell's bundled assets.

The bundled app and the web endpoint serve the SAME tree — this tool
is the packaging step that keeps that true mechanically:

  --write-manifest --app-dir <dogear/app tree> [--routes-only]
      Build android/bundle-manifest.json from the app tree: every
      route the worker serves (build.py's tables), the voice pack
      (pack/PACK-PIN.json), and the generated pack manifest, each
      with sha256 + bytes. Cross-checked against the app tree's own
      dist/build-manifest.json — a drift between the two fails the
      run, so the bundle can never quietly diverge from the tree
      that was gated and deployed.

      Bundle variants are FIRST-CLASS, chosen by flag — never by
      hand-editing the output:
        full (default): routes + the whole voice pack bundled
          (the beta.2 shape; models ride inside the APK).
        --routes-only: routes only, ZERO /pack/ entries (the
          beta.3/beta.4 shape; the shell ships alone and models
          are in-app downloads under their own licences).

  --stage --manifest <bundle-manifest.json> --out <assets/web dir>
          (--from-dir <dogear/app tree> | --from-live <base url>)
      Materialize the asset tree, verifying every file's sha256
      and byte count against the manifest. Any mismatch aborts:
      the bundle ships the pinned bytes or it does not ship.

Asset layout mirrors URL paths: "/" -> web/index.html,
"/privacy" -> web/privacy.html, "/app.js" -> web/app.js,
"/pack/v1/<rel>" -> web/pack/v1/<rel>.
"""
import argparse
import hashlib
import json
import pathlib
import sys
import urllib.request

# Route -> (source path inside the app tree, content type).
# Mirrors build.py's TEXT_ASSETS / INGEST_ASSETS / BIN_ASSETS plus
# the vendored reader-core pair. The manifest cross-check against
# dist/build-manifest.json keeps this table honest.
ROUTES = {
    "/": ("src/index.html", "text/html; charset=utf-8"),
    "/privacy": ("src/privacy.html", "text/html; charset=utf-8"),
    "/releases": ("src/releases.html", "text/html; charset=utf-8"),
    "/app.js": ("src/app.js", "text/javascript; charset=utf-8"),
    "/config.js": ("src/config.js", "text/javascript; charset=utf-8"),
    "/meter.js": ("src/meter.js", "text/javascript; charset=utf-8"),
    "/billing.js": ("src/billing.js", "text/javascript; charset=utf-8"),
    "/licence.js": ("src/licence.js", "text/javascript; charset=utf-8"),
    "/ingest.js": ("src/ingest.js", "text/javascript; charset=utf-8"),
    "/retrieval.js": ("src/retrieval.js", "text/javascript; charset=utf-8"),
    "/voicepack.js": ("src/voicepack.js", "text/javascript; charset=utf-8"),
    "/speaker.js": ("src/speaker.js", "text/javascript; charset=utf-8"),
    "/selfmodel.js": ("src/selfmodel.js", "text/javascript; charset=utf-8"),
    "/native-bridge.js": ("src/native-bridge.js", "text/javascript; charset=utf-8"),
    "/app.css": ("src/app.css", "text/css; charset=utf-8"),
    "/sw.js": ("src/sw.js", "text/javascript; charset=utf-8"),
    "/manifest.webmanifest": ("src/manifest.webmanifest", "application/manifest+json; charset=utf-8"),
    "/.well-known/assetlinks.json": ("src/assetlinks.json", "application/json; charset=utf-8"),
    "/reader-core.js": ("VENDOR_READER/reader-core.js", "text/javascript; charset=utf-8"),
    "/reader-core.css": ("VENDOR_READER/reader-core.css", "text/css; charset=utf-8"),
    "/vendor/pdf.min.mjs": ("vendor/ingest/pdf.min.mjs", "text/javascript; charset=utf-8"),
    "/vendor/pdf.worker.min.mjs": ("vendor/ingest/pdf.worker.min.mjs", "text/javascript; charset=utf-8"),
    "/vendor/mammoth.browser.min.js": ("vendor/ingest/mammoth.browser.min.js", "text/javascript; charset=utf-8"),
    "/vendor/jszip.min.js": ("vendor/ingest/jszip.min.js", "text/javascript; charset=utf-8"),
    "/vendor/nacl.min.js": ("vendor/ingest/nacl.min.js", "text/javascript; charset=utf-8"),
    "/icons/icon-192.png": ("src/icons/icon-192.png", "image/png"),
    "/icons/icon-512.png": ("src/icons/icon-512.png", "image/png"),
    "/icons/maskable-512.png": ("src/icons/maskable-512.png", "image/png"),
    "/icons/apple-touch-icon.png": ("src/icons/apple-touch-icon.png", "image/png"),
}

PACK_TYPES = {
    ".json": "application/json",
    ".onnx": "application/octet-stream",
    ".wasm": "application/wasm",
    ".mjs": "text/javascript; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".txt": "text/plain; charset=utf-8",
}


def sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def asset_rel(route: str) -> str:
    """URL route -> path inside the assets/web tree."""
    if route == "/":
        return "index.html"
    if route in ("/privacy", "/releases"):
        return route[1:] + ".html"
    return route[1:]


def reader_dir(app: pathlib.Path) -> pathlib.Path:
    pins = sorted((app / "vendor").glob("reader-core-*"))
    if len(pins) != 1:
        raise SystemExit("expected exactly one vendored reader-core pin")
    return pins[0]


def read_source(app: pathlib.Path, src: str) -> bytes:
    if src.startswith("VENDOR_READER/"):
        return (reader_dir(app) / src.split("/", 1)[1]).read_bytes()
    return (app / src).read_bytes()


def write_manifest(app: pathlib.Path, routes_only: bool = False) -> dict:
    dist = json.loads((app / "dist" / "build-manifest.json").read_text())
    dist_assets = dist["assets"]
    entries = []
    for route, (src, ctype) in sorted(ROUTES.items()):
        raw = read_source(app, src)
        digest = sha256(raw)
        want = dist_assets.get(route)
        if want is not None and want != digest:
            raise SystemExit(f"DRIFT {route}: tree {digest} != deployed manifest {want}")
        entries.append({"route": route, "asset": asset_rel(route),
                        "type": ctype, "bytes": len(raw), "sha256": digest,
                        "source": src})
    if routes_only:
        return {
            "worker": dist["worker"],
            "worker_sha256": dist["worker_sha256"],
            "web_version": json.loads((app / "package.json").read_text())["version"],
            "variant": "routes-only",
            "entries": entries,
            "total_bytes": sum(e["bytes"] for e in entries),
        }
    # The generated pack manifest (byte-identical to the deployed one).
    pm = (app / "dist" / "pack" / "v1" / "pack-manifest.json").read_bytes()
    entries.append({"route": "/pack/v1/pack-manifest.json",
                    "asset": "pack/v1/pack-manifest.json",
                    "type": "application/json", "bytes": len(pm),
                    "sha256": sha256(pm), "source": "dist/pack/v1/pack-manifest.json"})
    pin = json.loads((app / "pack" / "PACK-PIN.json").read_text())
    for f in pin["files"]:
        raw = (app / "pack" / "v1" / f["path"]).read_bytes()
        if len(raw) != f["bytes"] or sha256(raw) != f["sha256"]:
            raise SystemExit(f"PACK PIN MISMATCH {f['path']}")
        ext = pathlib.PurePosixPath(f["path"]).suffix
        entries.append({"route": "/pack/v1/" + f["path"],
                        "asset": "pack/v1/" + f["path"],
                        "type": PACK_TYPES.get(ext, "application/octet-stream"),
                        "bytes": len(raw), "sha256": f["sha256"],
                        "source": "pack/v1/" + f["path"]})
    return {
        "worker": dist["worker"],
        "worker_sha256": dist["worker_sha256"],
        "web_version": json.loads((app / "package.json").read_text())["version"],
        "variant": "full",
        "entries": entries,
        "total_bytes": sum(e["bytes"] for e in entries),
    }


def fetch_live(base: str, route: str) -> bytes:
    req = urllib.request.Request(base.rstrip("/") + route,
                                 headers={"User-Agent": "dogear-bundle/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def stage(manifest: dict, out: pathlib.Path, app: pathlib.Path | None,
          live: str | None) -> None:
    total = 0
    for e in manifest["entries"]:
        if live:
            raw = fetch_live(live, e["route"])
        else:
            raw = read_source(app, e["source"]) if not e["source"].startswith("dist/") \
                else (app / e["source"]).read_bytes()
        if len(raw) != e["bytes"] or sha256(raw) != e["sha256"]:
            raise SystemExit(f"VERIFY FAIL {e['route']}: got {len(raw)} bytes "
                             f"sha {sha256(raw)[:16]}…, want {e['bytes']} sha {e['sha256'][:16]}…")
        dest = out / e["asset"]
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(raw)
        total += len(raw)
    print(f"staged {len(manifest['entries'])} files, {total} bytes -> {out} "
          f"(all sha256 verified against bundle-manifest)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--write-manifest", action="store_true")
    ap.add_argument("--routes-only", action="store_true",
                    help="shell-only bundle variant: routes, zero /pack/ entries")
    ap.add_argument("--stage", action="store_true")
    ap.add_argument("--app-dir", type=pathlib.Path)
    ap.add_argument("--manifest", type=pathlib.Path)
    ap.add_argument("--out", type=pathlib.Path)
    ap.add_argument("--from-dir", type=pathlib.Path)
    ap.add_argument("--from-live")
    args = ap.parse_args()

    if args.write_manifest:
        if not args.app_dir or not args.out:
            ap.error("--write-manifest needs --app-dir and --out")
        m = write_manifest(args.app_dir, routes_only=args.routes_only)
        args.out.write_text(json.dumps(m, indent=2) + "\n")
        print(f"manifest: {len(m['entries'])} entries, {m['total_bytes']} bytes, "
              f"variant {m['variant']}, worker_sha256 {m['worker_sha256'][:16]}… -> {args.out}")
        return 0
    if args.stage:
        if not args.manifest or not args.out:
            ap.error("--stage needs --manifest and --out")
        if bool(args.from_dir) == bool(args.from_live):
            ap.error("--stage needs exactly one of --from-dir / --from-live")
        m = json.loads(args.manifest.read_text())
        stage(m, args.out, args.from_dir, args.from_live)
        return 0
    ap.error("one of --write-manifest / --stage is required")
    return 2


if __name__ == "__main__":
    sys.exit(main())

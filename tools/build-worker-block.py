#!/usr/bin/env python3
"""Build the worker-side dogearBlock() function from the canonical reader.

Reads reader/dogear.js and emits a JS function that returns the mount div +
inline <script> as an HTML string, safe to embed in a Cloudflare Worker that
builds pages with string concatenation.

Usage: python3 tools/build-worker-block.py > /tmp/dogear-block.js
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = HERE / "reader" / "dogear.js"

def main() -> None:
    src = SRC.read_text(encoding="utf-8")
    assert "</script" not in src.lower(), "dogear.js must not contain a literal </script>"
    # json.dumps -> one ASCII-safe double-quoted JS string literal
    js_literal = json.dumps(src, ensure_ascii=True)
    fn = (
        "function dogearBlock(){\n"
        "  // DogEar reader v1.0.4 — generated from nrupala/dogear reader/dogear.js; do not hand-edit.\n"
        "  return '<div data-dogear></div>'\n"
        "  + '<scr'+'ipt>'\n"
        "  + " + js_literal + "\n"
        "  + '</scr'+'ipt>';\n"
        "}\n"
    )
    sys.stdout.write(fn)

if __name__ == "__main__":
    main()

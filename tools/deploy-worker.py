#!/usr/bin/env python3
"""Deploy a module Worker via Cloudflare's multipart module-upload API.

Contract (learned 2026-09-29, TWF + onSmartGrid dogear deploys):
- PUT /accounts/{aid}/workers/scripts/{name} as multipart/form-data with a
  `metadata` JSON part {main_module, compatibility_date, bindings} plus the
  module file part.
- Re-send NON-SECRET bindings (KV namespaces, plain_text vars) or they are dropped.
- OMIT secret_text bindings: their values persist server-side; including one
  without its text 400s (code 10021).
- Uploading a module file as a service worker 400s ("Unexpected token 'export'").

Usage:
  deploy-worker.py <script_name> <module_file> <metadata_json>
  metadata_json: {"main_module": "...", "compatibility_date": "...", "bindings": [...]}

Auth: the user-connected custom.cloudflare credential (surrogate).
"""
import json
import sys
import urllib.request
import urllib.error

sys.path.insert(0, "/opt/hatch/skills/skill-creator/bin")
from dynamic_credentials import add_surrogate_to_request, read_response_body

AID = "2edd59d09fd816187b47afbb9ea43af1"
BASE = "https://api.cloudflare.com/client/v4"
CRED = "custom.cloudflare"
BOUNDARY = "----hatch-worker-deploy"


def put_script(name, module_bytes, metadata):
    body = b""

    def part(headers: bytes, data: bytes):
        nonlocal body
        body += ("--" + BOUNDARY + "\r\n").encode() + headers + b"\r\n\r\n" + data + b"\r\n"

    part(b'Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json',
         json.dumps(metadata).encode())
    mod = metadata["main_module"]
    part(('Content-Disposition: form-data; name="%s"; filename="%s"\r\n'
          "Content-Type: application/javascript+module" % (mod, mod)).encode(),
         module_bytes)
    body += ("--" + BOUNDARY + "--\r\n").encode()

    req = urllib.request.Request(
        f"{BASE}/accounts/{AID}/workers/scripts/{name}", data=body, method="PUT")
    req.add_header("Content-Type", f"multipart/form-data; boundary={BOUNDARY}")
    add_surrogate_to_request(req, CRED, allowed_hosts=("api.cloudflare.com",))
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(read_response_body(resp).decode("utf-8"))
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"HTTP {exc.code} PUT workers/scripts/{name}\n{exc.read().decode()[:600]}")


def fetch_live_module(name):
    """Fetch the live module source via the multipart-envelope GET trick.

    GET .../workers/scripts/{name}/content 405s; the bare script endpoint returns
    200 with the source wrapped in a single-part multipart envelope.
    """
    req = urllib.request.Request(f"{BASE}/accounts/{AID}/workers/scripts/{name}", method="GET")
    add_surrogate_to_request(req, CRED, allowed_hosts=("api.cloudflare.com",))
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = read_response_body(resp)
    import re
    m = re.search(rb'name="[^"]*"\r\n\r\n(.*)\r\n--', raw, re.S)
    return (m.group(1) if m else raw)


def main():
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    name, module_file, meta_json = sys.argv[1], sys.argv[2], sys.argv[3]
    module_bytes = open(module_file, "rb").read()
    metadata = json.loads(meta_json)
    for b in metadata.get("bindings", []):
        if b.get("type") == "secret_text" and "text" not in b:
            sys.exit(f"refusing: secret_text binding {b.get('name')} without text would 400; omit it")
    r = put_script(name, module_bytes, metadata)
    ok = r.get("success")
    vid = r.get("result", {}).get("id", "?")[:12] if isinstance(r.get("result"), dict) else "?"
    print(f"deploy success: {ok} | version: {vid}")
    live = fetch_live_module(name)
    print(f"live == deployed: {live == module_bytes} ({len(live)} bytes live)")


if __name__ == "__main__":
    main()

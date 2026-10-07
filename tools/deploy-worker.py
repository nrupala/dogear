#!/usr/bin/env python3
"""Deploy a module Worker to Cloudflare — SIGNED ONLY.

Standing rule (2026-10-05): every deploy goes through the site-integrity
signed-deploy wrapper. There is no unsigned path anymore: this script
delegates to ~/workspace/site-integrity/deploy_signed.py, which carries
forward the live script's non-secret bindings and compatibility date,
preserves server-side secrets, re-hashes the deployed bytes, and mints a
signed ledger certificate binding worker name + artifact SHA-256 + signer +
timestamp. The integrity watcher treats any deploy without a ledger
certificate as unauthorized.

Usage:
  deploy-worker.py <script_name> <module_file> [--note TEXT] [--main-module NAME]

Legacy positional metadata JSON (the old <script_name> <module_file>
<metadata_json> shape) is still accepted: it is parsed ONLY for
`main_module`. All bindings in it are IGNORED — the wrapper carries forward
the live script's bindings itself. Deploying a brand-new script that needs
bindings which do not exist yet should be done with deploy_signed.py
directly after the settings are created.
"""
import json
import subprocess
import sys

DEPLOY_SIGNED = "/home/hatch/workspace/site-integrity/deploy_signed.py"


def main() -> None:
    args = sys.argv[1:]
    if len(args) < 2 or any(a in ("-h", "--help") for a in args):
        sys.exit(__doc__)

    name, module_file = args[0], args[1]
    note = f"dogear deploy of {name} via signed wrapper"
    main_module = None

    i = 2
    while i < len(args):
        a = args[i]
        if a == "--note" and i + 1 < len(args):
            note = args[i + 1]
            i += 2
        elif a == "--main-module" and i + 1 < len(args):
            main_module = args[i + 1]
            i += 2
        elif not a.startswith("--") and main_module is None:
            # legacy third positional: metadata_json — main_module only
            try:
                main_module = json.loads(a).get("main_module")
            except Exception as exc:
                sys.exit(f"unrecognized argument {a!r}: {exc}")
            print("NOTE: metadata_json bindings are IGNORED — the signed "
                  "wrapper carries forward the live script's non-secret bindings.")
            i += 1
        else:
            sys.exit(f"unrecognized argument {a!r}\n{__doc__}")

    cmd = [sys.executable, DEPLOY_SIGNED, name, module_file, "--note", note]
    if main_module:
        cmd += ["--main-module", main_module]
    r = subprocess.run(cmd)
    if r.returncode != 0:
        raise SystemExit(f"signed deploy failed (exit {r.returncode})")
    print(f"{name} SIGNED DEPLOY OK")


if __name__ == "__main__":
    main()

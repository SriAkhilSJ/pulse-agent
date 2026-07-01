"""CLI for ad-hoc LSP queries — test LSP connections from the terminal.

Usage:
    python -m pulse_lsp.cli status                          # list all servers
    python -m pulse_lsp.cli check <file>                     # quick diagnostics
    python -m pulse_lsp.cli raw <file>                       # raw JSON diagnostics
    python -m pulse_lsp.cli install <server_id>              # install a server

Mirrors Hermes agent/lsp/cli.py.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import Any


def _ensure_path() -> None:
    """Ensure the agents dir is on sys.path so pulse_lsp is importable."""
    _dir = os.path.dirname(os.path.abspath(__file__))
    # pulse_lsp/cli.py -> pulse_lsp -> python/agents
    base = os.path.dirname(_dir)
    if base not in sys.path:
        sys.path.insert(0, base)


def cmd_status() -> None:
    """Print status of all registered LSP servers."""
    _ensure_path()
    from pulse_lsp.servers import get_all_servers
    from pulse_lsp.install import detect_status

    servers = get_all_servers()
    print(f"LSP Servers: {len(servers)} registered")
    print(f"{'Server ID':30s} {'Status':12s}  Description")
    print("-" * 80)
    for s in servers:
        st = detect_status(s.server_id)
        print(f"{s.server_id:30s} {st:12s}  {s.description}")
    print()


def cmd_check(file_path: str) -> None:
    """Run diagnostics on a file and print a human-readable summary."""
    _ensure_path()
    from pulse_lsp import get_service
    from pulse_lsp.reporter import format_diagnostics

    abs_path = os.path.abspath(file_path)
    if not os.path.isfile(abs_path):
        print(f"Error: file not found: {abs_path}")
        sys.exit(1)

    svc = get_service()
    if svc is None:
        print("Error: LSP service could not be initialized")
        sys.exit(1)

    if not svc.enabled_for(abs_path):
        print(f"LSP not available for: {abs_path}")
        print("  (no git repo, no matching server, or server disabled)")
        sys.exit(0)

    print(f"Checking: {abs_path}")
    diags = svc.open_and_diagnostics(abs_path)
    if diags:
        print(format_diagnostics(diags, abs_path))
    else:
        print("  ✅ No diagnostics — clean file")


def cmd_raw(file_path: str) -> None:
    """Run diagnostics and print raw JSON."""
    _ensure_path()
    from pulse_lsp import get_service

    abs_path = os.path.abspath(file_path)
    if not os.path.isfile(abs_path):
        print(json.dumps({"error": f"file not found: {abs_path}"}))
        sys.exit(1)

    svc = get_service()
    if svc is None:
        print(json.dumps({"error": "LSP service unavailable"}))
        sys.exit(1)

    diags = svc.open_and_diagnostics(abs_path)
    print(json.dumps(diags, indent=2, default=str))


def cmd_install(server_id: str) -> None:
    """Install a specific LSP server."""
    _ensure_path()
    from pulse_lsp.install import try_install, detect_status

    status_before = detect_status(server_id)
    print(f"Server '{server_id}': {status_before}")

    if status_before == "installed":
        print("Already installed.")
        return

    result = try_install(server_id, strategy="auto")
    if result:
        print(f"✅ Installed: {result}")
    else:
        print(f"❌ Installation failed or not supported for '{server_id}'")
        print("   Try manual install or check the binary name on PATH.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Pulse LSP CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="List all registered servers with status")

    check_p = sub.add_parser("check", help="Check diagnostics on a file")
    check_p.add_argument("file", help="Path to a source file")

    raw_p = sub.add_parser("raw", help="Get raw JSON diagnostics")
    raw_p.add_argument("file", help="Path to a source file")

    install_p = sub.add_parser("install", help="Install an LSP server")
    install_p.add_argument("server_id", help="Server ID (e.g. pyright, gopls)")

    args = parser.parse_args()

    dispatch = {
        "status": cmd_status,
        "check": lambda: cmd_check(args.file),
        "raw": lambda: cmd_raw(args.file),
        "install": lambda: cmd_install(args.server_id),
    }

    fn = dispatch.get(args.command)
    if fn:
        fn()
    else:
        parser.print_help()


if __name__ == "__main__":
    main()

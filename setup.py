#!/usr/bin/env python3
"""Cross-platform, stdlib-only bootstrapper for VexoStream YouTube Scraper."""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path


def banner() -> None:
    print("=" * 60)
    print("  VexoStream YouTube Scraper — Local Setup & Runner")
    print("=" * 60)


def find_deno() -> str | None:
    found = shutil.which("deno")
    if found:
        return found
    home_bin = Path.home() / ".deno" / "bin"
    candidate = home_bin / ("deno.exe" if platform.system() == "Windows" else "deno")
    if candidate.is_file():
        return str(candidate)
    return None


def prepend_deno_to_path() -> None:
    deno_bin = str(Path.home() / ".deno" / "bin")
    current = os.environ.get("PATH", "")
    parts = current.split(os.pathsep) if current else []
    if deno_bin not in parts:
        os.environ["PATH"] = deno_bin + (os.pathsep + current if current else "")


def install_deno() -> None:
    system = platform.system()
    print("[setup] Deno not found on PATH. Installing Deno...")
    if system == "Windows":
        cmd = [
            "powershell",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "irm https://deno.land/install.ps1 | iex",
        ]
    elif system in ("Linux", "Darwin"):
        cmd = ["sh", "-c", "curl -fsSL https://deno.land/install.sh | sh"]
    else:
        print(f"[error] Unsupported operating system: {system}", file=sys.stderr)
        sys.exit(1)

    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(
            "[error] Failed to install Deno automatically. "
            "Install it manually from https://deno.land and re-run setup.py.",
            file=sys.stderr,
        )
        sys.exit(result.returncode)

    prepend_deno_to_path()
    deno_bin = str(Path.home() / ".deno" / "bin")
    print(f"[setup] Added {deno_bin} to PATH for this session.")
    print(f"[setup] Tip: add {deno_bin} to your shell profile permanently.")


def run_step(cmd: list[str], cwd: Path, label: str) -> None:
    print(f"[setup] {label}: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(cwd), env=os.environ.copy(), check=False)
    if result.returncode != 0:
        print(f"[error] Step failed ({label}) with exit code {result.returncode}.", file=sys.stderr)
        sys.exit(result.returncode)


def main() -> None:
    banner()
    project_dir = Path(__file__).resolve().parent

    deno = find_deno()
    if not deno:
        install_deno()
        deno = find_deno()
    else:
        prepend_deno_to_path()

    if not deno:
        print(
            "[error] Deno still could not be located after installation. "
            "Ensure ~/.deno/bin is on your PATH and try again.",
            file=sys.stderr,
        )
        sys.exit(1)

    run_step([deno, "--version"], project_dir, "Verifying Deno")
    run_step([deno, "cache", "main.ts"], project_dir, "Caching dependencies")

    port = os.environ.get("PORT", "8000")
    print(f"[setup] Starting VexoStream YouTube Scraper on http://localhost:{port} ...")
    try:
        result = subprocess.run(
            [deno, "run", "--allow-net", "--allow-env", "--allow-read", "main.ts"],
            cwd=str(project_dir),
            env=os.environ.copy(),
            check=False,
        )
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        print("\n[setup] Server stopped.")
        sys.exit(0)


if __name__ == "__main__":
    main()

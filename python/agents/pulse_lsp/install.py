"""Auto-install LSP server binaries via npm, pip, or go.

Installs go to <PULSE_HOME>/lsp/bin/ to avoid polluting global toolchain.
Falls back to ~/.pulse/lsp/bin/.

Mirrors Hermes agent/lsp/install.py (403 lines → 296 lines).
"""
from __future__ import annotations

import logging
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("pulse.lsp.install")

INSTALL_RECIPES: Dict[str, Dict[str, Any]] = {
    "pyright": {"strategy": "npm", "pkg": "pyright", "bin": "pyright-langserver"},
    "typescript-language-server": {
        "strategy": "npm", "pkg": "typescript-language-server",
        "bin": "typescript-language-server", "extra_pkgs": ["typescript"],
    },
    "@vue/language-server": {"strategy": "npm", "pkg": "@vue/language-server", "bin": "vue-language-server"},
    "svelte-language-server": {"strategy": "npm", "pkg": "svelte-language-server", "bin": "svelteserver"},
    "@astrojs/language-server": {"strategy": "npm", "pkg": "@astrojs/language-server", "bin": "astro-ls"},
    "yaml-language-server": {"strategy": "npm", "pkg": "yaml-language-server", "bin": "yaml-language-server"},
    "bash-language-server": {"strategy": "npm", "pkg": "bash-language-server", "bin": "bash-language-server"},
    "dockerfile-language-server-nodejs": {
        "strategy": "npm", "pkg": "dockerfile-language-server-nodejs", "bin": "docker-langserver",
    },
    "intelephense": {"strategy": "npm", "pkg": "intelephense", "bin": "intelephense"},
    "gopls": {"strategy": "go", "pkg": "golang.org/x/tools/gopls@latest", "bin": "gopls"},
    "rust-analyzer": {"strategy": "manual", "pkg": "", "bin": "rust-analyzer"},
    "clangd": {"strategy": "manual", "pkg": "", "bin": "clangd"},
    "lua-language-server": {"strategy": "manual", "pkg": "", "bin": "lua-language-server"},
    "ocaml-lsp": {"strategy": "manual", "pkg": "", "bin": "ocamllsp"},
    "terraform-ls": {"strategy": "manual", "pkg": "", "bin": "terraform-ls"},
    "dart": {"strategy": "manual", "pkg": "", "bin": "dart"},
    "haskell-language-server": {"strategy": "manual", "pkg": "", "bin": "haskell-language-server"},
    "julia": {"strategy": "manual", "pkg": "", "bin": "julia"},
    "clojure-lsp": {"strategy": "manual", "pkg": "", "bin": "clojure-lsp"},
    "nixd": {"strategy": "manual", "pkg": "", "bin": "nixd"},
    "zls": {"strategy": "manual", "pkg": "", "bin": "zls"},
    "gleam": {"strategy": "manual", "pkg": "", "bin": "gleam"},
    "elixir-ls": {"strategy": "manual", "pkg": "", "bin": "elixir-ls"},
    "prisma": {"strategy": "manual", "pkg": "", "bin": "prisma"},
    "kotlin-language-server": {"strategy": "manual", "pkg": "", "bin": "kotlin-language-server"},
    "jdtls": {"strategy": "manual", "pkg": "", "bin": "jdtls"},
    "html-language-server": {"strategy": "manual", "pkg": "", "bin": "html-languageserver"},
    "css-language-server": {"strategy": "manual", "pkg": "", "bin": "css-languageserver"},
    "json-language-server": {"strategy": "manual", "pkg": "", "bin": "json-languageserver"},
    "marksman": {"strategy": "manual", "pkg": "", "bin": "marksman"},
    "taplo": {"strategy": "manual", "pkg": "", "bin": "taplo"},
}

_install_locks: Dict[str, threading.Lock] = {}
_install_results: Dict[str, Optional[str]] = {}
_install_lock_meta = threading.Lock()
_WINDOWS_WRAPPER_SUFFIXES = (".cmd", ".exe", ".bat")


def _is_windows() -> bool:
    return os.name == "nt"


def _lsp_bin_dir() -> Path:
    home = os.environ.get("PULSE_HOME") or os.path.join(os.path.expanduser("~"), ".pulse")
    p = Path(home) / "lsp" / "bin"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _native_binary_candidates(base: Path) -> list[Path]:
    candidates = [base]
    if _is_windows():
        existing = {str(base).lower()}
        for suffix in _WINDOWS_WRAPPER_SUFFIXES:
            candidate = Path(str(base) + suffix)
            key = str(candidate).lower()
            if key not in existing:
                candidates.append(candidate)
                existing.add(key)
    return candidates


def _existing_binary(name: str) -> Optional[str]:
    for staged in _native_binary_candidates(_lsp_bin_dir() / name):
        if staged.exists() and os.access(staged, os.X_OK):
            return str(staged)
    on_path = shutil.which(name)
    if on_path:
        return on_path
    if _is_windows():
        for suffix in _WINDOWS_WRAPPER_SUFFIXES:
            on_path = shutil.which(f"{name}{suffix}")
            if on_path:
                return on_path
    return None


def try_install(pkg: str, strategy: str = "auto") -> Optional[str]:
    if strategy not in {"auto"}:
        recipe = INSTALL_RECIPES.get(pkg, {})
        return _existing_binary(recipe.get("bin", pkg))
    if pkg in _install_results:
        return _install_results[pkg]
    lock = _install_locks.setdefault(pkg, threading.Lock())
    with lock:
        if pkg in _install_results:
            return _install_results[pkg]
        result = _do_install(pkg)
        _install_results[pkg] = result
        return result


def _do_install(pkg: str) -> Optional[str]:
    recipe = INSTALL_RECIPES.get(pkg)
    if recipe is None:
        return shutil.which(pkg)
    strategy = recipe.get("strategy", "manual")
    bin_name = recipe.get("bin", pkg)
    existing = _existing_binary(bin_name)
    if existing:
        return existing
    if strategy == "manual":
        logger.debug("[install] %s requires manual install", pkg)
        return None
    if strategy == "npm":
        return _install_npm(recipe.get("pkg", pkg), bin_name, recipe.get("extra_pkgs") or [])
    if strategy == "go":
        return _install_go(recipe.get("pkg", pkg), bin_name)
    if strategy == "pip":
        return _install_pip(recipe.get("pkg", pkg), bin_name)
    logger.warning("[install] unknown strategy %r for %s", strategy, pkg)
    return None


def _install_npm(pkg: str, bin_name: str, extra_pkgs: List[str]) -> Optional[str]:
    npm = shutil.which("npm")
    if npm is None:
        logger.info("[install] cannot install %s: npm not on PATH", pkg)
        return None
    staging = _lsp_bin_dir().parent
    targets = [pkg] + list(extra_pkgs)
    try:
        logger.info("[install] npm install --prefix %s %s", staging, " ".join(targets))
        subprocess.run(
            [npm, "install", "--prefix", str(staging), "--silent", "--no-fund", "--no-audit", *targets],
            check=False, capture_output=True, text=True, timeout=300, stdin=subprocess.DEVNULL,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("[install] npm install errored for %s: %s", pkg, e)
        return None
    nm_bin = staging / "node_modules" / ".bin" / bin_name
    for c in _native_binary_candidates(nm_bin):
        if c.exists():
            link = _lsp_bin_dir() / c.name
            if not link.exists():
                try:
                    link.symlink_to(c)
                except (OSError, NotImplementedError):
                    try:
                        shutil.copy2(c, link)
                    except OSError:
                        return str(c)
            return str(link if link.exists() else c)
    logger.warning("[install] npm install succeeded but bin %s not found", bin_name)
    return None


def _install_go(pkg: str, bin_name: str) -> Optional[str]:
    go = shutil.which("go")
    if go is None:
        logger.info("[install] cannot install %s: go not on PATH", pkg)
        return None
    staging = _lsp_bin_dir()
    env = dict(os.environ)
    env["GOBIN"] = str(staging)
    try:
        logger.info("[install] go install %s (GOBIN=%s)", pkg, staging)
        subprocess.run(
            [go, "install", pkg], check=False, capture_output=True, text=True,
            timeout=600, env=env, stdin=subprocess.DEVNULL,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("[install] go install errored for %s: %s", pkg, e)
        return None
    bin_path = staging / (bin_name if not _is_windows() else f"{bin_name}.exe")
    if bin_path.exists():
        return str(bin_path)
    logger.warning("[install] go install succeeded but bin %s not found", bin_name)
    return None


def _install_pip(pkg: str, bin_name: str) -> Optional[str]:
    """Install a Python package via pip --target into a hermes-owned dir."""
    pip_target = _lsp_bin_dir().parent / "python-packages"
    pip_target.mkdir(parents=True, exist_ok=True)
    try:
        logger.info("[install] pip install --target %s %s", pip_target, pkg)
        subprocess.run(
            [sys.executable, "-m", "pip", "install", "--target", str(pip_target), "--quiet", pkg],
            check=False, capture_output=True, text=True, timeout=300, stdin=subprocess.DEVNULL,
        )
    except (subprocess.TimeoutExpired, OSError) as e:
        logger.warning("[install] pip install errored for %s: %s", pkg, e)
        return None
    script_dirs = [pip_target / "bin"]
    if _is_windows():
        script_dirs.append(pip_target / "Scripts")
    for script_dir in script_dirs:
        for bin_path in _native_binary_candidates(script_dir / bin_name):
            if bin_path.exists():
                link = _lsp_bin_dir() / bin_path.name
                if not link.exists():
                    try:
                        link.symlink_to(bin_path)
                    except (OSError, NotImplementedError):
                        try:
                            shutil.copy2(bin_path, link)
                        except OSError:
                            return str(bin_path)
                return str(link if link.exists() else bin_path)
    return None


def detect_status(pkg: str) -> str:
    recipe = INSTALL_RECIPES.get(pkg)
    bin_name = recipe.get("bin", pkg) if recipe else pkg
    if _existing_binary(bin_name):
        return "installed"
    if recipe and recipe.get("strategy") == "manual":
        return "manual-only"
    return "missing"


__all__ = ["try_install", "detect_status", "INSTALL_RECIPES"]

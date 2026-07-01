"""Per-language LSP server definitions and spawn builders.

31 servers total — covers the most common file types.
"""
from __future__ import annotations

import logging
import os
import shutil
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from pulse_lsp.workspace import nearest_root

logger = logging.getLogger("pulse.lsp.servers")

LANGUAGE_BY_EXT: Dict[str, str] = {
    ".py": "python", ".pyi": "python",
    ".ts": "typescript", ".tsx": "typescriptreact",
    ".js": "javascript", ".jsx": "javascriptreact",
    ".mjs": "javascript", ".cjs": "javascript",
    ".mts": "typescript", ".cts": "typescript",
    ".go": "go",
    ".rs": "rust",
    ".rb": "ruby", ".rake": "ruby", ".ru": "ruby", ".gemspec": "ruby",
    ".c": "c", ".h": "c",
    ".cc": "cpp", ".cpp": "cpp", ".cxx": "cpp",
    ".hh": "cpp", ".hpp": "cpp", ".hxx": "cpp",
    ".cs": "csharp", ".csx": "csharp",
    ".java": "java",
    ".kt": "kotlin", ".kts": "kotlin",
    ".yaml": "yaml", ".yml": "yaml",
    ".json": "json", ".jsonc": "jsonc",
    ".lua": "lua",
    ".php": "php",
    ".sh": "shellscript", ".bash": "shellscript", ".zsh": "shellscript", ".ksh": "shellscript",
    ".tf": "terraform", ".tfvars": "terraform",
    ".md": "markdown",
    ".css": "css", ".scss": "scss", ".less": "less",
    ".html": "html", ".htm": "html",
    ".xhtml": "html",
    ".vue": "vue",
    ".svelte": "svelte",
    ".astro": "astro",
    ".swift": "swift",
    ".dart": "dart",
    ".ex": "elixir", ".exs": "elixir",
    ".zig": "zig", ".zon": "zig",
    ".dockerfile": "dockerfile",
    ".tex": "latex", ".bib": "bibtex",
    ".hs": "haskell", ".lhs": "haskell",
    ".jl": "julia",
    ".ml": "ocaml", ".mli": "ocaml",
    ".clj": "clojure", ".cljs": "clojurescript", ".cljc": "clojure", ".edn": "clojure",
    ".nix": "nix",
    ".gleam": "gleam",
    ".typ": "typst", ".typc": "typst",
    ".prisma": "prisma",
    ".fs": "fsharp", ".fsi": "fsharp", ".fsx": "fsharp",
}

BASENAME_LANGUAGE: Dict[str, str] = {
    "Dockerfile": "dockerfile",
    "Makefile": "makefile",
    "Rakefile": "ruby",
    "Gemfile": "ruby",
    "Cask": "emacs-lisp",
}


def language_id_for(path: str) -> str:
    base = os.path.basename(path)
    bl = BASENAME_LANGUAGE.get(base)
    if bl:
        return bl
    _, ext = os.path.splitext(base)
    return LANGUAGE_BY_EXT.get(ext.lower(), "")


@dataclass
class SpawnSpec:
    command: List[str]
    workspace_root: str
    cwd: str
    env: Dict[str, str] = field(default_factory=dict)
    initialization_options: Dict[str, Any] = field(default_factory=dict)
    seed_diagnostics_on_first_push: bool = False


@dataclass
class ServerDef:
    server_id: str
    extensions: Tuple[str, ...]
    resolve_root: Callable[[str, str], Optional[str]]
    build_spawn: Callable[[str, "ServerContext"], Optional[SpawnSpec]]
    seed_first_push: bool = False
    description: str = ""

    def matches(self, file_path: str) -> bool:
        ext = _file_ext_or_basename(file_path)
        return ext in self.extensions


@dataclass
class ServerContext:
    workspace_root: str
    install_strategy: str = "auto"
    binary_overrides: Dict[str, List[str]] = field(default_factory=dict)
    env_overrides: Dict[str, Dict[str, str]] = field(default_factory=dict)
    init_overrides: Dict[str, Dict[str, Any]] = field(default_factory=dict)


# ── Helpers ──────────────────────────────────────────────────────────────

def _file_ext_or_basename(path: str) -> str:
    base = os.path.basename(path)
    _, ext = os.path.splitext(base)
    return ext.lower() if ext else base


def _which(*names: str) -> Optional[str]:
    for n in names:
        p = shutil.which(n)
        if p:
            return p
    return None


def _resolve_override(ctx: ServerContext, server_id: str) -> Optional[List[str]]:
    raw = ctx.binary_overrides.get(server_id)
    if isinstance(raw, list) and raw:
        return raw
    return None


def _root_or_workspace(file_path: str, workspace: str, markers: Sequence[str], excludes: Sequence[str] = ()) -> Optional[str]:
    found = nearest_root(file_path, markers, excludes=excludes, ceiling=os.path.dirname(workspace) if workspace else None)
    if found is None and excludes:
        recheck = nearest_root(file_path, markers, ceiling=os.path.dirname(workspace) if workspace else None)
        if recheck is not None:
            return None
        return workspace
    return found or workspace


# ── Spawn builders ───────────────────────────────────────────────────────

def _detect_python(root: str) -> Optional[str]:
    candidates = []
    if os.environ.get("VIRTUAL_ENV"):
        candidates.append(os.environ["VIRTUAL_ENV"])
    candidates.extend([os.path.join(root, ".venv"), os.path.join(root, "venv")])
    for v in candidates:
        for sub in ("bin/python", "bin/python3", "Scripts/python.exe"):
            p = os.path.join(v, sub)
            if os.path.exists(p):
                return p
    return None


def _spawn_pyright(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "pyright") or _which("pyright-langserver", "pyright")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("pyright", ctx.install_strategy)
        if bin_path is None:
            return None
    base = os.path.basename(bin_path)
    if base in {"pyright", "pyright.exe"}:
        sibling = os.path.join(os.path.dirname(bin_path), "pyright-langserver")
        if os.path.exists(sibling):
            bin_path = sibling
    init: Dict[str, Any] = {}
    py = _detect_python(root)
    if py:
        init["python"] = {"pythonPath": py}
    if "pyright" in ctx.init_overrides:
        init.update(ctx.init_overrides["pyright"])
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("pyright", {}),
        initialization_options=init,
    )


def _spawn_typescript(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "typescript") or _which("typescript-language-server")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("typescript-language-server", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("typescript", {}),
        initialization_options=ctx.init_overrides.get("typescript", {}),
        seed_diagnostics_on_first_push=True,
    )


def _spawn_vue(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "vue-language-server") or _which("vue-language-server")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("@vue/language-server", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("vue-language-server", {}),
        initialization_options=ctx.init_overrides.get("vue-language-server", {}),
    )


def _spawn_svelte(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "svelte-language-server") or _which("svelteserver", "svelte-language-server")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("svelte-language-server", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("svelte-language-server", {}),
        initialization_options=ctx.init_overrides.get("svelte-language-server", {}),
    )


def _spawn_astro(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "astro-language-server") or _which("astro-ls", "astro-language-server")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("@astrojs/language-server", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("astro-language-server", {}),
        initialization_options=ctx.init_overrides.get("astro-language-server", {}),
    )


def _spawn_gopls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "gopls") or _which("gopls")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("gopls", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("gopls", {}),
        initialization_options=ctx.init_overrides.get("gopls", {}),
    )


def _spawn_rust_analyzer(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "rust-analyzer") or _which("rust-analyzer")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("rust-analyzer", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("rust-analyzer", {}),
        initialization_options=ctx.init_overrides.get("rust-analyzer", {}),
    )


def _spawn_clangd(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "clangd") or _which("clangd")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("clangd", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path, "--background-index", "--clang-tidy"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("clangd", {}),
        initialization_options=ctx.init_overrides.get("clangd", {}),
    )


def _spawn_bash_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "bash-language-server") or _which("bash-language-server")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("bash-language-server", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path, "start"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("bash-language-server", {}),
        initialization_options=ctx.init_overrides.get("bash-language-server", {}),
    )


def _spawn_yaml_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "yaml-language-server") or _which("yaml-language-server")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("yaml-language-server", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("yaml-language-server", {}),
        initialization_options=ctx.init_overrides.get("yaml-language-server", {}),
    )


def _spawn_lua_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "lua-language-server") or _which("lua-language-server")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("lua-language-server", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("lua-language-server", {}),
        initialization_options=ctx.init_overrides.get("lua-language-server", {}),
    )


def _spawn_intelephense(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "intelephense") or _which("intelephense")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("intelephense", ctx.install_strategy)
        if bin_path is None:
            return None
    init = {"telemetry": {"enabled": False}}
    init.update(ctx.init_overrides.get("intelephense", {}))
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("intelephense", {}),
        initialization_options=init,
    )


def _spawn_ocamllsp(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "ocaml-lsp") or _which("ocamllsp")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("ocaml-lsp", {}),
        initialization_options=ctx.init_overrides.get("ocaml-lsp", {}),
    )


def _spawn_terraform_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "terraform-ls") or _which("terraform-ls")
    if bin_path is None:
        return None
    init = {"experimentalFeatures": {"prefillRequiredFields": True, "validateOnSave": True}}
    init.update(ctx.init_overrides.get("terraform-ls", {}))
    return SpawnSpec(
        command=[bin_path, "serve"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("terraform-ls", {}),
        initialization_options=init,
    )


def _spawn_dart(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "dart") or _which("dart")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "language-server", "--lsp"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("dart", {}),
        initialization_options=ctx.init_overrides.get("dart", {}),
    )


def _spawn_haskell_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "haskell-language-server") or _which("haskell-language-server-wrapper", "haskell-language-server")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "--lsp"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("haskell-language-server", {}),
        initialization_options=ctx.init_overrides.get("haskell-language-server", {}),
    )


def _spawn_julia(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "julia") or _which("julia")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "--startup-file=no", "--history-file=no", "-e", "using LanguageServer; runserver()"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("julia", {}),
        initialization_options=ctx.init_overrides.get("julia", {}),
    )


def _spawn_clojure_lsp(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "clojure-lsp") or _which("clojure-lsp")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "listen"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("clojure-lsp", {}),
        initialization_options=ctx.init_overrides.get("clojure-lsp", {}),
    )


def _spawn_dockerfile_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "dockerfile-ls") or _which("docker-langserver")
    if bin_path is None:
        from pulse_lsp.install import try_install
        bin_path = try_install("dockerfile-language-server-nodejs", ctx.install_strategy)
        if bin_path is None:
            return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("dockerfile-ls", {}),
        initialization_options=ctx.init_overrides.get("dockerfile-ls", {}),
    )


def _spawn_nixd(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "nixd") or _which("nixd")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("nixd", {}),
        initialization_options=ctx.init_overrides.get("nixd", {}),
    )


def _spawn_zls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "zls") or _which("zls")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("zls", {}),
        initialization_options=ctx.init_overrides.get("zls", {}),
    )


def _spawn_gleam(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "gleam") or _which("gleam")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "lsp"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("gleam", {}),
        initialization_options=ctx.init_overrides.get("gleam", {}),
    )


def _spawn_elixir_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "elixir-ls") or _which("elixir-ls", "language_server.sh")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("elixir-ls", {}),
        initialization_options=ctx.init_overrides.get("elixir-ls", {}),
    )


def _spawn_prisma(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "prisma") or _which("prisma")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "language-server"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("prisma", {}),
        initialization_options=ctx.init_overrides.get("prisma", {}),
    )


def _spawn_kotlin_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "kotlin-language-server") or _which("kotlin-language-server")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("kotlin-language-server", {}),
        initialization_options=ctx.init_overrides.get("kotlin-language-server", {}),
    )


def _spawn_jdtls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "jdtls") or _which("jdtls")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("jdtls", {}),
        initialization_options=ctx.init_overrides.get("jdtls", {}),
    )


# ── Web / Document Language Servers ──────────────────────────────────────


def _spawn_html_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "html-language-server") or _which("html-languageserver", "vscode-html-languageserver", "html-language-server")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("html-language-server", {}),
    )


def _spawn_css_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "css-language-server") or _which("css-languageserver", "vscode-css-languageserver", "css-language-server")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("css-language-server", {}),
    )


def _spawn_json_ls(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "json-language-server") or _which("json-languageserver", "vscode-json-languageserver", "json-language-server")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("json-language-server", {}),
    )


def _spawn_marksman(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "marksman") or _which("marksman")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("marksman", {}),
    )


def _spawn_taplo(root: str, ctx: ServerContext) -> Optional[SpawnSpec]:
    bin_path = _resolve_override(ctx, "taplo") or _which("taplo", "taplo-lsp")
    if bin_path is None:
        return None
    return SpawnSpec(
        command=[bin_path, "lsp", "--stdio"],
        workspace_root=root, cwd=root,
        env=ctx.env_overrides.get("taplo", {}),
    )


# ── Registry ─────────────────────────────────────────────────────────────

_SERVERS: List[ServerDef] = [
    ServerDef(
        server_id="pyright", extensions=(".py", ".pyi"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile", "pyrightconfig.json"]),
        build_spawn=_spawn_pyright,
        description="Python — Microsoft pyright",
    ),
    ServerDef(
        server_id="typescript", extensions=(".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["package-lock.json", "bun.lockb", "bun.lock", "pnpm-lock.yaml", "yarn.lock", "package.json", "tsconfig.json"], excludes=["deno.json", "deno.jsonc"]),
        build_spawn=_spawn_typescript, seed_first_push=True,
        description="JavaScript/TypeScript — typescript-language-server",
    ),
    ServerDef(
        server_id="vue-language-server", extensions=(".vue",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["package.json", "tsconfig.json"]),
        build_spawn=_spawn_vue,
        description="Vue.js — @vue/language-server",
    ),
    ServerDef(
        server_id="svelte-language-server", extensions=(".svelte",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["package.json"]),
        build_spawn=_spawn_svelte,
        description="Svelte — svelte-language-server",
    ),
    ServerDef(
        server_id="astro-language-server", extensions=(".astro",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["package.json", "astro.config.mjs", "astro.config.ts"]),
        build_spawn=_spawn_astro,
        description="Astro — @astrojs/language-server",
    ),
    ServerDef(
        server_id="gopls", extensions=(".go",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["go.work", "go.mod", "go.sum"]),
        build_spawn=_spawn_gopls,
        description="Go — gopls",
    ),
    ServerDef(
        server_id="rust-analyzer", extensions=(".rs",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["Cargo.toml", "Cargo.lock"]),
        build_spawn=_spawn_rust_analyzer,
        description="Rust — rust-analyzer",
    ),
    ServerDef(
        server_id="clangd", extensions=(".c", ".cpp", ".cc", ".cxx", ".h", ".hh", ".hpp", ".hxx"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["compile_commands.json", "compile_flags.txt", ".clangd"]),
        build_spawn=_spawn_clangd,
        description="C/C++ — clangd",
    ),
    ServerDef(
        server_id="bash-language-server", extensions=(".sh", ".bash", ".zsh", ".ksh"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, []),
        build_spawn=_spawn_bash_ls,
        description="Bash — bash-language-server",
    ),
    ServerDef(
        server_id="yaml-language-server", extensions=(".yaml", ".yml"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, []),
        build_spawn=_spawn_yaml_ls,
        description="YAML — yaml-language-server",
    ),
    ServerDef(
        server_id="lua-language-server", extensions=(".lua",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, [".luarc.json", ".luarc.jsonc", ".luacheckrc", ".stylua.toml"]),
        build_spawn=_spawn_lua_ls,
        description="Lua — lua-language-server",
    ),
    ServerDef(
        server_id="intelephense", extensions=(".php",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["composer.json", "composer.lock"]),
        build_spawn=_spawn_intelephense,
        description="PHP — intelephense",
    ),
    ServerDef(
        server_id="ocaml-lsp", extensions=(".ml", ".mli"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["dune-project", "dune-workspace", ".merlin", "opam"]),
        build_spawn=_spawn_ocamllsp,
        description="OCaml — ocaml-lsp",
    ),
    ServerDef(
        server_id="dockerfile-ls", extensions=("Dockerfile", ".dockerfile"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, []),
        build_spawn=_spawn_dockerfile_ls,
        description="Dockerfile — dockerfile-language-server-nodejs",
    ),
    ServerDef(
        server_id="terraform-ls", extensions=(".tf", ".tfvars"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, [".terraform.lock.hcl", "terraform.tfstate"]),
        build_spawn=_spawn_terraform_ls,
        description="Terraform — terraform-ls",
    ),
    ServerDef(
        server_id="dart", extensions=(".dart",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["pubspec.yaml", "analysis_options.yaml"]),
        build_spawn=_spawn_dart,
        description="Dart — built-in language server",
    ),
    ServerDef(
        server_id="haskell-language-server", extensions=(".hs", ".lhs"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["stack.yaml", "cabal.project", "hie.yaml"]),
        build_spawn=_spawn_haskell_ls,
        description="Haskell — haskell-language-server",
    ),
    ServerDef(
        server_id="julia", extensions=(".jl",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["Project.toml", "Manifest.toml"]),
        build_spawn=_spawn_julia,
        description="Julia — LanguageServer.jl",
    ),
    ServerDef(
        server_id="clojure-lsp", extensions=(".clj", ".cljs", ".cljc", ".edn"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["deps.edn", "project.clj", "shadow-cljs.edn", "bb.edn", "build.boot"]),
        build_spawn=_spawn_clojure_lsp,
        description="Clojure — clojure-lsp",
    ),
    ServerDef(
        server_id="nixd", extensions=(".nix",),
        resolve_root=lambda fp, ws: nearest_root(fp, ["flake.nix"]) or ws,
        build_spawn=_spawn_nixd,
        description="Nix — nixd",
    ),
    ServerDef(
        server_id="zls", extensions=(".zig", ".zon"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["build.zig"]),
        build_spawn=_spawn_zls,
        description="Zig — zls",
    ),
    ServerDef(
        server_id="gleam", extensions=(".gleam",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["gleam.toml"]),
        build_spawn=_spawn_gleam,
        description="Gleam — built-in language server",
    ),
    ServerDef(
        server_id="elixir-ls", extensions=(".ex", ".exs"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["mix.exs", "mix.lock"]),
        build_spawn=_spawn_elixir_ls,
        description="Elixir — elixir-ls",
    ),
    ServerDef(
        server_id="prisma", extensions=(".prisma",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["schema.prisma", "prisma/schema.prisma"]),
        build_spawn=_spawn_prisma,
        description="Prisma — built-in language server",
    ),
    ServerDef(
        server_id="kotlin-language-server", extensions=(".kt", ".kts"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["settings.gradle", "settings.gradle.kts", "build.gradle", "build.gradle.kts", "pom.xml"]),
        build_spawn=_spawn_kotlin_ls,
        description="Kotlin — kotlin-language-server",
    ),
    ServerDef(
        server_id="jdtls", extensions=(".java",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, ["pom.xml", "build.gradle", "build.gradle.kts", ".project", ".classpath"]),
        build_spawn=_spawn_jdtls,
        description="Java — Eclipse JDT Language Server",
    ),
    ServerDef(
        server_id="html-language-server", extensions=(".html", ".htm", ".xhtml"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, []),
        build_spawn=_spawn_html_ls,
        description="HTML — vscode-html-languageserver",
    ),
    ServerDef(
        server_id="css-language-server", extensions=(".css", ".scss", ".less"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, []),
        build_spawn=_spawn_css_ls,
        description="CSS/SCSS/Less — vscode-css-languageserver",
    ),
    ServerDef(
        server_id="json-language-server", extensions=(".json", ".jsonc", ".json5"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, []),
        build_spawn=_spawn_json_ls,
        description="JSON — vscode-json-languageserver",
    ),
    ServerDef(
        server_id="marksman", extensions=(".md", ".markdown"),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, []),
        build_spawn=_spawn_marksman,
        description="Markdown — marksman",
    ),
    ServerDef(
        server_id="taplo", extensions=(".toml",),
        resolve_root=lambda fp, ws: _root_or_workspace(fp, ws, []),
        build_spawn=_spawn_taplo,
        description="TOML — taplo",
    ),
]


def find_server_for_file(file_path: str) -> Optional[ServerDef]:
    ext = _file_ext_or_basename(file_path)
    for srv in _SERVERS:
        if ext in srv.extensions:
            return srv
    return None


def get_all_servers() -> List[ServerDef]:
    return list(_SERVERS)


__all__ = [
    "language_id_for", "find_server_for_file", "get_all_servers",
    "ServerDef", "ServerContext", "SpawnSpec",
    "LANGUAGE_BY_EXT",
]

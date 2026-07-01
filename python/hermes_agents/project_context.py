"""Project context scanner — reads codebase structure and existing code patterns.

This gives the agents the same "organs" Hermes has:
- Detect project type (Rust, Python, TypeScript)
- Read existing file structure
- Extract code patterns from existing files
- Understand what already exists before generating new code.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional


# Project root markers (like Hermes coding_context.py)
PROJECT_MARKERS = (
    "Cargo.toml", "pyproject.toml", "setup.py", "package.json",
    "go.mod", "pom.xml", "build.gradle", "Gemfile",
    "CMakeLists.txt", "Makefile", "Dockerfile",
    "AGENTS.md", "CLAUDE.md", ".cursorrules",
)

# Language detection
RUST_MARKERS = ("Cargo.toml", "Cargo.lock", ".rs")
PYTHON_MARKERS = ("pyproject.toml", "setup.py", "requirements.txt", ".py")
TS_MARKERS = ("package.json", "tsconfig.json", ".ts", ".tsx")
GO_MARKERS = ("go.mod", ".go")


@dataclass
class ProjectContext:
    """Scanned project context — what the agent knows about the codebase."""
    root: str
    project_type: str  # rust, python, typescript, go, mixed
    language: str  # primary language
    name: str  # project name from Cargo.toml/pyproject.toml
    modules: list[str] = field(default_factory=list)  # crate/module names
    existing_files: dict[str, str] = field(default_factory=dict)  # path -> first 2000 chars
    patterns: dict[str, Any] = field(default_factory=dict)  # detected patterns
    dependencies: list[str] = field(default_factory=list)  # project dependencies
    architecture: str = ""  # detected architecture pattern

    def to_prompt_context(self) -> str:
        """Format as context for LLM prompt."""
        parts = [
            f"Project: {self.name}",
            f"Type: {self.project_type}",
            f"Language: {self.language}",
            f"Root: {self.root}",
        ]
        if self.modules:
            parts.append(f"Modules: {', '.join(self.modules[:20])}")
        if self.dependencies:
            deps = ', '.join(self.dependencies[:15])
            parts.append(f"Dependencies: {deps}")
        if self.patterns:
            if self.patterns.get("error_type"):
                parts.append(f"Error handling: {self.patterns['error_type']}")
            if self.patterns.get("async_runtime"):
                parts.append(f"Async runtime: {self.patterns['async_runtime']}")
            if self.patterns.get("test_framework"):
                parts.append(f"Test framework: {self.patterns['test_framework']}")
        if self.existing_files:
            parts.append(f"Existing files: {', '.join(list(self.existing_files.keys())[:15])}")
        if self.architecture:
            parts.append(f"Architecture: {self.architecture}")
        return "\n".join(parts)


def scan_project(root: str) -> ProjectContext:
    """Scan a project directory and extract context."""
    root = os.path.abspath(root)
    project_type = _detect_project_type(root)
    language = _detect_primary_language(root)
    name = _detect_project_name(root)
    modules = _find_modules(root)
    dependencies = _extract_dependencies(root, project_type)
    patterns = _detect_patterns(root, project_type)
    architecture = _detect_architecture(root, modules)
    existing_files = _read_key_files(root, project_type)

    return ProjectContext(
        root=root,
        project_type=project_type,
        language=language,
        name=name,
        modules=modules,
        existing_files=existing_files,
        patterns=patterns,
        dependencies=dependencies,
        architecture=architecture,
    )


def _detect_project_type(root: str) -> str:
    """Detect what kind of project this is."""
    markers = {
        "rust": ["Cargo.toml"],
        "python": ["pyproject.toml", "setup.py", "requirements.txt"],
        "typescript": ["package.json", "tsconfig.json"],
        "go": ["go.mod"],
    }
    for ptype, files in markers.items():
        for f in files:
            if os.path.exists(os.path.join(root, f)):
                return ptype
    return "unknown"


def _detect_primary_language(root: str) -> str:
    """Detect primary programming language."""
    counts = {"rust": 0, "python": 0, "typescript": 0, "go": 0}
    for _, _, files in os.walk(root):
        for f in files:
            if f.endswith(".rs"):
                counts["rust"] += 1
            elif f.endswith(".py"):
                counts["python"] += 1
            elif f.endswith((".ts", ".tsx")):
                counts["typescript"] += 1
            elif f.endswith(".go"):
                counts["go"] += 1
    return max(counts, key=counts.get) if max(counts.values()) > 0 else "unknown"


def _detect_project_name(root: str) -> str:
    """Read project name from manifest."""
    cargo = os.path.join(root, "Cargo.toml")
    if os.path.exists(cargo):
        with open(cargo) as f:
            for line in f:
                if line.strip().startswith("name"):
                    m = re.search(r'name\s*=\s*"([^"]+)"', line)
                    if m:
                        return m.group(1)
    pyproject = os.path.join(root, "pyproject.toml")
    if os.path.exists(pyproject):
        with open(pyproject) as f:
            for line in f:
                if line.strip().startswith("name"):
                    m = re.search(r'name\s*=\s*"([^"]+)"', line)
                    if m:
                        return m.group(1)
    return os.path.basename(root)


def _find_modules(root: str) -> list[str]:
    """Find Rust crates or Python packages."""
    modules = []
    cargo = os.path.join(root, "Cargo.toml")
    if os.path.exists(cargo):
        with open(cargo) as f:
            content = f.read()
        # Find workspace members
        m = re.search(r'members\s*=\s*\[(.*?)\]', content, re.DOTALL)
        if m:
            members = re.findall(r'"([^"]+)"', m.group(1))
            modules.extend(members)
    return modules


def _extract_dependencies(root: str, project_type: str) -> list[str]:
    """Extract key dependencies."""
    deps = []
    if project_type == "rust":
        cargo = os.path.join(root, "Cargo.toml")
        if os.path.exists(cargo):
            with open(cargo) as f:
                in_deps = False
                for line in f:
                    if "[dependencies]" in line:
                        in_deps = True
                        continue
                    if in_deps and line.startswith("["):
                        break
                    if in_deps and "=" in line:
                        name = line.split("=")[0].strip()
                        if name:
                            deps.append(name)
    return deps


def _detect_patterns(root: str, project_type: str) -> dict[str, Any]:
    """Detect code patterns from existing files."""
    patterns = {}
    if project_type == "rust":
        # Check for thiserror
        for _, _, files in os.walk(os.path.join(root, "crates")):
            for f in files:
                if f.endswith(".rs"):
                    path = os.path.join(root, "crates", f)
                    try:
                        with open(path) as fh:
                            content = fh.read(5000)
                        if "thiserror" in content or "#[derive(Error" in content:
                            patterns["error_type"] = "thiserror"
                        if "tokio" in content:
                            patterns["async_runtime"] = "tokio"
                        if "#[tokio::test]" in content:
                            patterns["test_framework"] = "tokio-test"
                        if "#[derive(Debug, Serialize, Deserialize)]" in content:
                            patterns["serialization"] = "serde"
                    except Exception:
                        pass
    return patterns


def _detect_architecture(root: str, modules: list[str]) -> str:
    """Detect architecture pattern."""
    if modules:
        if len(modules) > 5:
            return f"multi-crate workspace ({len(modules)} crates)"
        return f"workspace with {', '.join(modules)}"
    return "single crate"


def _read_key_files(root: str, project_type: str) -> dict[str, str]:
    """Read first 2000 chars of key source files for context."""
    files = {}
    if project_type == "rust":
        src_dir = os.path.join(root, "crates")
        if os.path.exists(src_dir):
            for crate in os.listdir(src_dir):
                crate_src = os.path.join(src_dir, crate, "src")
                if os.path.isdir(crate_src):
                    for fname in os.listdir(crate_src):
                        if fname.endswith(".rs"):
                            path = os.path.join(crate_src, fname)
                            try:
                                with open(path) as f:
                                    files[f"crates/{crate}/src/{fname}"] = f.read(2000)
                            except Exception:
                                pass
    return files


def read_file_for_context(file_path: str, max_chars: int = 4000) -> str:
    """Read a specific file for context."""
    if not os.path.exists(file_path):
        # Try relative to project root
        for root in [".", "D:/pulse", os.getcwd()]:
            full = os.path.join(root, file_path)
            if os.path.exists(full):
                file_path = full
                break
    try:
        with open(file_path) as f:
            return f.read(max_chars)
    except Exception:
        return ""

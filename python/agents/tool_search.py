"""
Pulse Agent — Tool Search & Dynamic Filtering.

Extends the basic tool discovery in tools/__init__.py with:
- ToolRegistry: central registry with metadata, categories, and search
- Context-aware filtering: show only relevant tools based on task type
- Tool categories for organization
- Usage tracking for relevance ordering

Design:
- Replaces flat discover_tools() with a richer ToolRegistry
- Backward compatible: ToolRegistry can convert to OpenAI tool format
- No breaking changes to existing tool modules
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# Tool metadata
# ═══════════════════════════════════════════════════════════════════════════════

class ToolCategory:
    """Tool category constants."""
    CODE_READ = "code_read"        # reading/exploring code
    CODE_WRITE = "code_write"      # writing/modifying code
    FILE_OPS = "file_ops"          # general file operations
    SEARCH = "search"              # searching content
    EXECUTION = "execution"        # running commands/code
    NETWORK = "network"            # web/network tools
    MEMORY = "memory"              # persistent memory
    SESSION = "session"            # session management
    KNOWLEDGE = "knowledge"        # skills/knowledge
    DIAGNOSTICS = "diagnostics"    # LSP/linting/diagnostics
    DEBUG = "debug"                # debugging helpers
    IDE = "ide"                    # IDE-specific (approval, etc.)
    MCP = "mcp"                    # MCP-proxied tools
    UTILITY = "utility"            # general utilities
    SYSTEM = "system"              # system operations


# Danger levels for approval gating
class ToolDangerLevel:
    SAFE = "safe"           # read-only, no side effects
    LOW = "low"             # minor writes (logs, configs)
    MEDIUM = "medium"       # code modification
    HIGH = "high"           # destructive operations (delete, overwrite)
    CRITICAL = "critical"   # security-sensitive (env, credentials)


@dataclass
class ToolInfo:
    """Rich metadata for a tool in the registry."""
    name: str
    description: str
    parameters: dict
    category: str = ToolCategory.UTILITY
    danger_level: str = ToolDangerLevel.SAFE
    requires_approval: bool = False
    run_fn: Callable | None = None
    keywords: tuple[str, ...] = ()
    requires_lsp: bool = False
    requires_network: bool = False
    hidden: bool = False  # hidden from auto-discovery lists

    def to_openai_format(self) -> dict:
        """Convert to OpenAI tool definition format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def execute(self, **kwargs) -> str:
        """Execute the tool's run function.

        Returns a string result (JSON or text).
        """
        if self.run_fn is None:
            return json.dumps({"error": f"Tool '{self.name}' has no run function"})
        try:
            result = self.run_fn(**kwargs)
            if not isinstance(result, str):
                result = json.dumps(result, default=str)
            return result
        except Exception as e:
            logger.error("Tool '%s' execution failed: %s", self.name, e, exc_info=True)
            return json.dumps({"error": f"Tool execution failed: {e}"})

    def matches_query(self, query: str) -> bool:
        """Check if tool matches a search query.

        Matches against name, description, and keywords.
        Case-insensitive substring match.
        """
        q = query.lower()
        if q in self.name.lower():
            return True
        if q in self.description.lower():
            return True
        for kw in self.keywords:
            if q in kw.lower():
                return True
        return False


# ═══════════════════════════════════════════════════════════════════════════════
# ToolRegistry
# ═══════════════════════════════════════════════════════════════════════════════

class ToolRegistry:
    """Central registry for Pulse Agent tools with search and filtering.

    Usage::

        registry = ToolRegistry()
        registry.register(ToolInfo(...))

        # Convert to OpenAI format
        tool_defs = registry.to_openai_format()

        # Search
        results = registry.search("file")

        # Context-aware filtering
        code_tools = registry.get_tools_for_context("coding")
    """

    def __init__(self):
        self._tools: dict[str, ToolInfo] = {}
        self._usage_counts: dict[str, int] = {}

    # ── Registration ────────────────────────────────────────────────────────

    def register(self, tool: ToolInfo) -> None:
        """Register a tool. Overwrites if name already exists."""
        self._tools[tool.name] = tool
        if tool.name not in self._usage_counts:
            self._usage_counts[tool.name] = 0

    def register_from_module(self, module: Any) -> bool:
        """Register a tool from a Python module with expected attributes.

        Expects the module to have: name, description, parameters, run.
        Returns True if registered successfully.
        """
        for attr in ("name", "description", "parameters", "run"):
            if not hasattr(module, attr):
                logger.debug("Module %s missing required attribute '%s'", module.__name__, attr)
                return False

        # Extract optional attributes
        category = getattr(module, "category", ToolCategory.UTILITY)
        danger_level = getattr(module, "danger_level", ToolDangerLevel.SAFE)
        requires_approval = getattr(module, "requires_approval", False)
        keywords = getattr(module, "keywords", ())
        hidden = getattr(module, "hidden", False)
        requires_lsp = getattr(module, "requires_lsp", False)
        requires_network = getattr(module, "requires_network", False)

        self.register(ToolInfo(
            name=module.name,
            description=module.description,
            parameters=module.parameters,
            category=category,
            danger_level=danger_level,
            requires_approval=requires_approval,
            run_fn=module.run,
            keywords=keywords,
            hidden=hidden,
            requires_lsp=requires_lsp,
            requires_network=requires_network,
        ))
        return True

    def register_mcp_tools(self, mcp_tools: list) -> list[str]:
        """Register MCP-proxied tools.

        Args:
            mcp_tools: List of MCPToolDef objects.

        Returns:
            List of registered tool names.
        """
        registered = []
        for mt in mcp_tools:
            # Wrap MCP tool calls in a ToolInfo
            self._tools[mt.name] = ToolInfo(
                name=mt.name,
                description=mt.description,
                parameters=mt.input_schema,
                category=ToolCategory.MCP,
                danger_level=ToolDangerLevel.LOW,
                requires_approval=False,
                keywords=(mt.server_name, "mcp"),
                hidden=False,
            )
            registered.append(mt.name)

        return registered

    def unregister(self, name: str) -> None:
        """Remove a tool from the registry."""
        self._tools.pop(name, None)
        self._usage_counts.pop(name, None)

    # ── Queries ─────────────────────────────────────────────────────────────

    def get(self, name: str) -> ToolInfo | None:
        """Get a tool by name."""
        return self._tools.get(name)

    def get_all(self, include_hidden: bool = False) -> list[ToolInfo]:
        """Get all registered tools, optionally including hidden ones."""
        if include_hidden:
            return list(self._tools.values())
        return [t for t in self._tools.values() if not t.hidden]

    def get_by_category(self, category: str) -> list[ToolInfo]:
        """Get all tools in a category."""
        return [t for t in self._tools.values() if t.category == category and not t.hidden]

    @property
    def count(self) -> int:
        """Number of non-hidden tools."""
        return len([t for t in self._tools.values() if not t.hidden])

    def names(self) -> list[str]:
        """List all non-hidden tool names."""
        return [t.name for t in self._tools.values() if not t.hidden]

    # ── Search ──────────────────────────────────────────────────────────────

    def search(self, query: str) -> list[ToolInfo]:
        """Search tools by name, description, or keywords.

        Returns matching tools ordered by relevance: name match > keyword match > desc match.
        """
        if not query or not query.strip():
            return self.get_all()

        q = query.lower().strip()
        scored: list[tuple[ToolInfo, int]] = []

        for tool in self._tools.values():
            if tool.hidden:
                continue

            score = 0
            # Exact name match (highest)
            if tool.name.lower() == q:
                score += 100
            # Name starts with query
            elif tool.name.lower().startswith(q):
                score += 50
            # Name contains query
            elif q in tool.name.lower():
                score += 30
            # Keyword match
            for kw in tool.keywords:
                if q in kw.lower():
                    score += 20
                    break
            # Description contains query
            if q in tool.description.lower():
                score += 10
            # Category match
            if q in tool.category.lower():
                score += 5

            if score > 0:
                scored.append((tool, score))

        # Sort by score descending, then name
        scored.sort(key=lambda x: (-x[1], x[0].name))
        return [t for t, _ in scored]

    # ── Context-aware filtering ─────────────────────────────────────────────

    def get_tools_for_context(
        self,
        task_type: str = "",
        has_lsp: bool = False,
        has_network: bool = True,
    ) -> list[ToolInfo]:
        """Get tools appropriate for the current context.

        Args:
            task_type: "chat", "code", "debug", "search", "refactor", or empty for all.
            has_lsp: Whether LSP tools are available.
            has_network: Whether network tools can be used.

        Returns:
            Filtered list of tools, ordered by category relevance.
        """
        all_tools = self.get_all()

        if not task_type:
            return all_tools

        task_type = task_type.lower().strip()
        category_order = self._category_relevance(task_type)
        filtered = []

        for tool in all_tools:
            # Skip tools requiring LSP if not available
            if tool.requires_lsp and not has_lsp:
                continue
            # Skip tools requiring network if not available
            if tool.requires_network and not has_network:
                continue
            filtered.append(tool)

        # Sort by category relevance
        filtered.sort(key=lambda t: (
            category_order.get(t.category, 99),
            -self._usage_counts.get(t.name, 0),
            t.name,
        ))

        return filtered

    # ── OpenAI format ───────────────────────────────────────────────────────

    def to_openai_format(
        self,
        task_type: str = "",
        has_lsp: bool = False,
        has_network: bool = True,
    ) -> list[dict]:
        """Get tool definitions in OpenAI format, optionally filtered by context.

        This is the main integration point with the agent loop.
        """
        tools = self.get_tools_for_context(
            task_type=task_type,
            has_lsp=has_lsp,
            has_network=has_network,
        )
        return [t.to_openai_format() for t in tools]

    # ── Usage tracking ──────────────────────────────────────────────────────

    def record_usage(self, tool_name: str) -> None:
        """Record that a tool was used (for relevance ordering)."""
        if tool_name in self._usage_counts:
            self._usage_counts[tool_name] += 1

    def get_usage_stats(self) -> dict[str, int]:
        """Get tool usage counts."""
        return dict(self._usage_counts)

    # ── Internal ────────────────────────────────────────────────────────────

    def _category_relevance(self, task_type: str) -> dict[str, int]:
        """Map task types to category relevance order (lower = more relevant)."""
        ordering = {
            "chat": {
                ToolCategory.KNOWLEDGE: 1,
                ToolCategory.MEMORY: 2,
                ToolCategory.SESSION: 3,
                ToolCategory.SEARCH: 4,
                ToolCategory.NETWORK: 5,
                ToolCategory.UTILITY: 10,
            },
            "code": {
                ToolCategory.CODE_READ: 1,
                ToolCategory.CODE_WRITE: 2,
                ToolCategory.FILE_OPS: 3,
                ToolCategory.SEARCH: 4,
                ToolCategory.DIAGNOSTICS: 5,
                ToolCategory.DEBUG: 6,
                ToolCategory.EXECUTION: 7,
                ToolCategory.MCP: 8,
                ToolCategory.IDE: 9,
                ToolCategory.KNOWLEDGE: 10,
                ToolCategory.UTILITY: 20,
            },
            "debug": {
                ToolCategory.DEBUG: 1,
                ToolCategory.DIAGNOSTICS: 2,
                ToolCategory.CODE_READ: 3,
                ToolCategory.SEARCH: 4,
                ToolCategory.EXECUTION: 5,
                ToolCategory.SESSION: 6,
                ToolCategory.UTILITY: 20,
            },
            "search": {
                ToolCategory.SEARCH: 1,
                ToolCategory.CODE_READ: 2,
                ToolCategory.FILE_OPS: 3,
                ToolCategory.NETWORK: 4,
                ToolCategory.SESSION: 5,
                ToolCategory.UTILITY: 20,
            },
            "refactor": {
                ToolCategory.CODE_READ: 1,
                ToolCategory.CODE_WRITE: 2,
                ToolCategory.DIAGNOSTICS: 3,
                ToolCategory.SEARCH: 4,
                ToolCategory.FILE_OPS: 5,
                ToolCategory.DEBUG: 6,
                ToolCategory.EXECUTION: 7,
                ToolCategory.MCP: 8,
                ToolCategory.UTILITY: 20,
            },
        }
        return ordering.get(task_type, {})


# ═══════════════════════════════════════════════════════════════════════════════
# Auto-discovery (replaces tools/__init__.py discover_tools)
# ═══════════════════════════════════════════════════════════════════════════════

_TOOLS_DIR = Path(__file__).parent / "tools"


def discover_tools_from_directory(tools_dir: str | Path | None = None) -> ToolRegistry:
    """Auto-discover all tool modules and register them into a ToolRegistry.

    This is the replacement for tools/__init__.py discover_tools().
    It finds Python modules in the tools/ directory, imports them,
    and registers them as ToolInfo objects.

    Usage::

        registry = discover_tools_from_directory()
        tools_for_api = registry.to_openai_format(task_type="code")
    """
    import importlib.util

    registry = ToolRegistry()
    scan_dir = Path(tools_dir) if tools_dir else _TOOLS_DIR

    if not scan_dir.is_dir():
        logger.warning("Tools directory not found: %s", scan_dir)
        return registry

    for f in sorted(scan_dir.glob("*.py")):
        if f.name == "__init__.py":
            continue

        mod_name = f.stem
        spec = importlib.util.spec_from_file_location(mod_name, f)
        if spec is None or spec.loader is None:
            continue

        try:
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            registry.register_from_module(mod)
        except Exception as e:
            logger.warning("Failed to load tool module '%s': %s", mod_name, e)

    logger.info("Discovered %d tools from %s", registry.count, scan_dir)
    return registry

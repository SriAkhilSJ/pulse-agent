"""Tool registry — discovers and provides tool definitions + execution."""
from __future__ import annotations
from pathlib import Path
import importlib.util
import os

_TOOLS_DIR = Path(__file__).parent

class Tool:
    def __init__(self, name: str, description: str, parameters: dict, run_fn):
        self.name = name
        self.description = description
        self.parameters = parameters
        self.run_fn = run_fn

    def to_openai_format(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def execute(self, **kwargs) -> str:
        return self.run_fn(**kwargs)


def discover_tools() -> dict[str, Tool]:
    """Auto-discover all tool modules in the tools/ directory."""
    tools = {}
    for f in sorted(_TOOLS_DIR.glob("*.py")):
        if f.name == "__init__.py":
            continue
        mod_name = f.stem
        spec = importlib.util.spec_from_file_location(mod_name, f)
        if spec is None or spec.loader is None:
            continue
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        if hasattr(mod, "name") and hasattr(mod, "run"):
            tools[mod.name] = Tool(
                name=mod.name,
                description=mod.description,
                parameters=mod.parameters,
                run_fn=mod.run,
            )
    return tools

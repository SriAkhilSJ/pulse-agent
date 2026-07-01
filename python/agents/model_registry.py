"""Model registry — reads YAML config, provides model definitions."""

from __future__ import annotations

import os
import yaml
from dataclasses import dataclass, field

_PATH = os.path.join(os.path.dirname(__file__), "model_registry.yaml")


@dataclass
class ModelDef:
    id: str
    provider: str
    context_window: int
    max_output_tokens: int
    cost_per_1k_input: float
    cost_per_1k_output: float
    capabilities: list[str] = field(default_factory=list)


@dataclass
class Registry:
    models: dict[str, ModelDef]


def load(path: str = _PATH) -> Registry:
    with open(path, encoding="utf-8") as f:
        raw = yaml.safe_load(f)
    models: dict[str, ModelDef] = {}
    for m in raw.get("models", []):
        models[m["id"]] = ModelDef(**m)
    return Registry(models=models)


def get_model(registry: Registry, model_id: str) -> ModelDef:
    """Get a model definition by ID."""
    m = registry.models.get(model_id)
    if not m:
        raise ValueError(f"Unknown model: {model_id}")
    return m

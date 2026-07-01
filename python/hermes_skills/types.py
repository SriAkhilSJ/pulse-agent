"""Skill data models."""
from __future__ import annotations

from pydantic import BaseModel
from typing import Any


class SkillDefinition(BaseModel):
    """A reusable skill extracted from workflow patterns."""
    skill_id: str
    name: str
    description: str
    steps: list[str]
    triggers: list[str] = []
    metadata: dict[str, Any] = {}

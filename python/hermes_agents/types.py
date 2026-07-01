"""Shared Python types for the agent system."""
from __future__ import annotations

from pydantic import BaseModel
from enum import Enum


class LLMTier(str, Enum):
    LOCAL = "local"
    EDGE = "edge"
    CLOUD = "cloud"


class TaskType(str, Enum):
    FEATURE = "feature"
    BUGFIX = "bugfix"
    REFACTOR = "refactor"
    DOCS = "docs"
    MIGRATION = "migration"


class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class TaskDescription(BaseModel):
    task_id: str
    task_type: TaskType
    description: str
    context: dict[str, str] = {}

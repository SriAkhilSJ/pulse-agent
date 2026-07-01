"""Pulse Agent — Skills types and data structures."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any
import time


@dataclass
class Skill:
    """A reusable skill/procedure that the agent can learn and execute.

    Format: YAML frontmatter + markdown body (compatible with Hermes skills).
    """
    name: str
    description: str
    content: str  # full SKILL.md content (YAML frontmatter + body)
    category: str = ""
    tags: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    usage_count: int = 0
    version: int = 1

    @property
    def trigger_words(self) -> list[str]:
        """Extract trigger words from the YAML frontmatter."""
        triggers = []
        if self.content.startswith("---"):
            parts = self.content.split("---", 2)
            if len(parts) >= 3:
                for line in parts[1].split("\n"):
                    line = line.strip()
                    if line.startswith("triggers:"):
                        for t in line[9:].split(","):
                            t = t.strip().strip('"').strip("'")
                            if t:
                                triggers.append(t.lower())
        return triggers

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "category": self.category,
            "tags": self.tags,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "usage_count": self.usage_count,
            "version": self.version,
            "content_length": len(self.content),
        }

    @classmethod
    def from_dict(cls, data: dict) -> Skill:
        return cls(
            name=data["name"],
            description=data.get("description", ""),
            content=data.get("content", ""),
            category=data.get("category", ""),
            tags=data.get("tags", []),
            created_at=data.get("created_at", time.time()),
            updated_at=data.get("updated_at", time.time()),
            usage_count=data.get("usage_count", 0),
            version=data.get("version", 1),
        )

"""Task complexity classifier for LLM routing."""
from __future__ import annotations

from hermes_agents.types import LLMTier
import structlog

logger = structlog.get_logger()


class ComplexityClassifier:
    """Classifies task complexity to determine LLM tier."""

    def classify(self, task_description: str, context_size: int) -> LLMTier:
        """Route simple tasks to local, complex to cloud."""
        if context_size < 4000 and len(task_description) < 200:
            return LLMTier.LOCAL
        if context_size > 32000:
            return LLMTier.CLOUD
        return LLMTier.EDGE

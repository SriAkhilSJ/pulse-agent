"""Code embedding models."""
from __future__ import annotations

import structlog

logger = structlog.get_logger()


class EmbeddingModel:
    """Placeholder for code embedding model."""

    async def embed(self, code: str) -> list[float]:
        """Generate embedding vector for code snippet."""
        logger.debug("generating_embedding")
        return [0.0] * 768  # Placeholder

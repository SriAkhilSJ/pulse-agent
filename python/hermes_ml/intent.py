"""Predictive intent model."""
from __future__ import annotations

import structlog

logger = structlog.get_logger()


class IntentPredictor:
    """Predicts what the developer will do next."""

    async def predict(self, context: dict) -> dict[str, float]:
        """Return predicted intents with confidence scores."""
        logger.debug("predicting_intent")
        return {"continue_function": 0.5, "write_test": 0.3}

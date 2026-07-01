"""ACP request handlers."""
from __future__ import annotations

import structlog

logger = structlog.get_logger()


class RequestHandlers:
    """Handlers for ACP method calls."""

    async def handle_initialize(self, params: dict) -> dict:
        """Handle the initialize request."""
        logger.info("handle_initialize")
        return {"capabilities": {}}

    async def handle_chat(self, params: dict) -> dict:
        """Handle chat messages."""
        logger.info("handle_chat")
        return {"response": "Hello from Surpassing agent (placeholder)"}

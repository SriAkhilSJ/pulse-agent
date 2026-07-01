"""Python-side ACP server for IDE communication."""
from __future__ import annotations

import structlog

logger = structlog.get_logger()


class ACPServer:
    """Handles JSON-RPC communication with IDE adapters."""

    async def start(self) -> None:
        """Start the ACP server."""
        logger.info("acp_server_starting")

    async def stop(self) -> None:
        """Stop the ACP server."""
        logger.info("acp_server_stopping")

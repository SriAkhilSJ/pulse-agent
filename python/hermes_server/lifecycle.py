"""Server lifecycle management."""
from __future__ import annotations

import structlog

logger = structlog.get_logger()


class ServerLifecycle:
    """Manages startup and shutdown sequences."""

    async def startup(self) -> None:
        """Run startup sequence."""
        logger.info("server_startup")
        # TODO: initialize connections, load models

    async def shutdown(self) -> None:
        """Run graceful shutdown."""
        logger.info("server_shutdown")
        # TODO: flush memory, close connections

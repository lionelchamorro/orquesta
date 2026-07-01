"""Rich-backed logging wrapper for orquesta_api."""

import logging
import os

from rich.logging import RichHandler


def get_logger(name: str) -> logging.Logger:
    """Return a named logger configured with RichHandler at LOG_LEVEL.

    Idempotent: calling with the same name multiple times adds no duplicate handlers.
    """
    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    logger = logging.getLogger(name)
    logger.setLevel(level)

    if not logger.handlers:
        handler = RichHandler(rich_tracebacks=True, show_path=False)
        handler.setLevel(level)
        logger.addHandler(handler)

    return logger

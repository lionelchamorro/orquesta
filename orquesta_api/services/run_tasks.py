"""Background task tracking for run supervision."""

import asyncio

from orquesta_api.logger import get_logger

logger = get_logger(__name__)

SUPERVISOR_TASKS: set[asyncio.Task[None]] = set()


def _log_task_exception(task: asyncio.Task[None]) -> None:
    """Log background task failures after retrieving the task exception."""
    if task.cancelled():
        return
    exc = task.exception()
    if exc is None:
        return
    logger.exception(
        "Supervisor task failed",
        exc_info=(type(exc), exc, exc.__traceback__),
    )


def track(task: asyncio.Task[None]) -> None:
    """Register a task so it is not garbage-collected before it completes."""
    SUPERVISOR_TASKS.add(task)
    task.add_done_callback(SUPERVISOR_TASKS.discard)
    task.add_done_callback(_log_task_exception)

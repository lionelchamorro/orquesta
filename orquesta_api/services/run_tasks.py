"""Background task tracking for run supervision."""

import asyncio

SUPERVISOR_TASKS: set[asyncio.Task[None]] = set()


def track(task: asyncio.Task[None]) -> None:
    """Register a task so it is not garbage-collected before it completes."""
    SUPERVISOR_TASKS.add(task)
    task.add_done_callback(SUPERVISOR_TASKS.discard)

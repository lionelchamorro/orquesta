"""Tests for run supervision background task tracking."""

import asyncio
import logging

from orquesta_api.services.run_tasks import SUPERVISOR_TASKS, track


async def test_track_logs_failed_task_and_removes_it(caplog) -> None:
    async def fail() -> None:
        raise RuntimeError("finalize failed")

    caplog.set_level(logging.ERROR, logger="orquesta_api.services.run_tasks")

    task = asyncio.create_task(fail())
    track(task)
    await asyncio.gather(task, return_exceptions=True)
    await asyncio.sleep(0)

    assert task not in SUPERVISOR_TASKS
    assert "Supervisor task failed" in caplog.text
    assert "finalize failed" in caplog.text

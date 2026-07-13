"""Tests for project registry orchestration."""

import asyncio
import time
from pathlib import Path

from orquesta_api.core.integrations import git
from orquesta_api.services.projects import ProjectService


async def test_create_checks_existing_workspace_git_state_without_blocking_event_loop(
    session, tmp_path: Path, monkeypatch
) -> None:
    """Existing-workspace git detection is moved off the event loop."""
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    loop = asyncio.get_running_loop()
    entered_git_check = asyncio.Event()

    def slow_is_git_repo(path: Path | str) -> bool:
        loop.call_soon_threadsafe(entered_git_check.set)
        time.sleep(0.05)
        return False

    monkeypatch.setattr(git, "is_git_repo", slow_is_git_repo)

    task = asyncio.create_task(
        ProjectService(session).create(
            name="Project",
            workspace_path=str(workspace),
            base_branch="main",
        )
    )
    started_at = time.perf_counter()
    await asyncio.wait_for(entered_git_check.wait(), timeout=1)

    assert time.perf_counter() - started_at < 0.02
    assert not task.done()
    await asyncio.wait_for(task, timeout=1)

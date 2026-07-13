"""Tests for repository lifecycle orchestration."""

import asyncio
import time
from pathlib import Path

from orquesta_api.core.integrations import git
from orquesta_api.db.tables import ProjectRow, RepoRow
from orquesta_api.services.repos import RepoManager


async def test_status_runs_git_boundary_without_blocking_event_loop(session, monkeypatch) -> None:
    """Slow git status work is moved off the event loop."""
    session.add(ProjectRow(id="proj1", name="Project", workspace_path="/workspace"))
    session.add(
        RepoRow(
            id="repo1",
            project_id="proj1",
            root="/workspace",
            base_branch="main",
            managed=True,
        )
    )
    await session.commit()

    def slow_status(path: Path | str) -> git.GitStatus:
        time.sleep(0.05)
        return git.GitStatus(
            current_branch="main",
            head_sha="abc123",
            dirty=False,
            remote_url="https://example.test/repo.git",
        )

    monkeypatch.setattr(git, "status", slow_status)

    task = asyncio.create_task(RepoManager(session).status("proj1"))
    started_at = time.perf_counter()
    await asyncio.sleep(0.001)

    assert time.perf_counter() - started_at < 0.02
    assert not task.done()
    await asyncio.wait_for(task, timeout=1)

"""Tests for PATCH /projects/{id} — watch flags persist independently.

Step 1 brief requirement: {watch: {prs: true, issues: false}} persists both
flags independently (prs and issues are separate DB columns, not a single bool).
"""

from pathlib import Path

import pytest

from orquesta_api.db.tables import ProjectRow
from orquesta_api.services.projects import ProjectService


@pytest.fixture
async def project_id(session, tmp_path: Path) -> str:
    """Seed a minimal project row with both watch flags off."""
    row = ProjectRow(
        id="test-proj",
        name="Test Project",
        workspace_path=str(tmp_path / "test-proj"),
        watch_prs=False,
        watch_issues=False,
    )
    session.add(row)
    await session.commit()
    return "test-proj"


async def test_watch_prs_true_issues_false(session, project_id: str) -> None:
    """{watch: {prs: true, issues: false}} persists prs=True, issues=False independently."""
    svc = ProjectService(session)
    row = await svc.update(project_id, watch={"prs": True, "issues": False})
    assert row.watch_prs is True
    assert row.watch_issues is False


async def test_watch_prs_false_issues_true(session, project_id: str) -> None:
    """{watch: {prs: false, issues: true}} persists prs=False, issues=True independently."""
    svc = ProjectService(session)
    row = await svc.update(project_id, watch={"prs": False, "issues": True})
    assert row.watch_prs is False
    assert row.watch_issues is True


async def test_watch_both_true(session, project_id: str) -> None:
    """{watch: {prs: true, issues: true}} sets both flags to True."""
    svc = ProjectService(session)
    row = await svc.update(project_id, watch={"prs": True, "issues": True})
    assert row.watch_prs is True
    assert row.watch_issues is True


async def test_watch_partial_prs_only_preserves_issues(session, project_id: str) -> None:
    """When only prs key is present in watch dict, issues falls back to row value.

    Decision: exclude_none=True is kept in the router, so ProjectWatch requires
    both flags when provided (they're non-optional booleans). A partial dict
    in the service falls back to the current row value for the missing key.
    This test documents that behaviour explicitly.
    """
    # First set issues=True
    svc = ProjectService(session)
    await svc.update(project_id, watch={"prs": False, "issues": True})
    # Partial patch with only prs key
    row = await svc.update(project_id, watch={"prs": True})
    assert row.watch_prs is True
    # issues falls back to current row value (True from previous update)
    assert row.watch_issues is True

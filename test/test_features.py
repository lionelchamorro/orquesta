"""Tests for feature-queue service and the POST /projects/{id}/features endpoint.

Three axes:
1. Pure file-format functions in FeatureService (format_feature_block,
   append_feature_to_file) — exercised without a DB session.
2. FeatureService.add_feature — verifies it writes the correct format to disk
   given a workspace-path-bearing ProjectRow in the DB.
3. Chat tool _tool_append_feature — verifies it uses the same write path as
   FeatureService (round-tripped through format_feature_block) so chat and the
   UI endpoint produce identical queue entries.
"""

from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.tables import ProjectRow
from orquesta_api.services.features import (
    FeatureService,
    append_feature_to_file,
    features_file_path,
    format_feature_block,
)

# ---------------------------------------------------------------------------
# 1. Pure file-format functions
# ---------------------------------------------------------------------------


def test_format_feature_block_with_description() -> None:
    block = format_feature_block("My Feature", "Some plan text.")
    assert block == "\n## My Feature\n\nSome plan text.\n"


def test_format_feature_block_empty_description() -> None:
    block = format_feature_block("Title Only", "")
    assert block == "\n## Title Only\n"


def test_format_feature_block_strips_leading_hashes_from_title() -> None:
    # If the caller passes "## My Title", the leading ## must be stripped so
    # the output is "## My Title" (our one-level heading) rather than
    # "## ## My Title" (a double-nested heading).
    block = format_feature_block("## My Title", "plan")
    assert "## ## My Title" not in block
    assert "## My Title" in block


def test_format_feature_block_raises_for_empty_title() -> None:
    with pytest.raises(ValueError, match="empty"):
        format_feature_block("", "some plan")


def test_append_feature_to_file_creates_file_when_absent(tmp_path: Path) -> None:
    path = tmp_path / "features.md"
    append_feature_to_file(path, "First feature", "Do the thing.")
    content = path.read_text(encoding="utf-8")
    assert "# Features" in content
    assert "## First feature" in content
    assert "Do the thing." in content


def test_append_feature_to_file_appends_to_existing_file(tmp_path: Path) -> None:
    path = tmp_path / "features.md"
    # Seed with one feature (matching the real features.md header style).
    path.write_text("# Project Features\n\n## Existing feature\n\nOld plan.\n", encoding="utf-8")
    append_feature_to_file(path, "New feature", "New plan.")
    content = path.read_text(encoding="utf-8")
    assert "## Existing feature" in content
    assert "## New feature" in content
    assert "New plan." in content
    # Existing content must appear before new content.
    assert content.index("## Existing feature") < content.index("## New feature")


def test_append_feature_to_file_round_trips_as_valid_markdown(tmp_path: Path) -> None:
    """Each ## section heading must be parseable as a discrete feature entry."""
    path = tmp_path / "features.md"
    for i in range(3):
        append_feature_to_file(path, f"Feature {i}", f"Plan {i}")
    content = path.read_text(encoding="utf-8")
    headings = [line for line in content.splitlines() if line.startswith("## ")]
    assert len(headings) == 3
    assert headings[0] == "## Feature 0"
    assert headings[1] == "## Feature 1"
    assert headings[2] == "## Feature 2"


def test_features_file_path_is_under_workspace(tmp_path: Path) -> None:
    p = features_file_path(str(tmp_path))
    assert p == tmp_path / "features.md"
    assert p.is_absolute()


# ---------------------------------------------------------------------------
# 2. FeatureService.add_feature — DB-backed
# ---------------------------------------------------------------------------


@pytest.fixture
async def project_with_workspace(session: AsyncSession, tmp_path: Path) -> tuple[str, Path]:
    workspace = tmp_path / "myproject"
    workspace.mkdir()
    row = ProjectRow(id="myproject", name="My Project", workspace_path=str(workspace), state="idle")
    session.add(row)
    await session.commit()
    return "myproject", workspace


async def test_add_feature_writes_correct_format(
    session: AsyncSession, project_with_workspace: tuple[str, Path]
) -> None:
    project_id, workspace = project_with_workspace
    svc = FeatureService(session)
    returned_path = await svc.add_feature(project_id, "Auth refactor", "Replace JWT lib.")
    # Returned path must point to features.md inside the workspace.
    assert returned_path == workspace / "features.md"
    content = returned_path.read_text(encoding="utf-8")
    assert "## Auth refactor" in content
    assert "Replace JWT lib." in content


async def test_add_feature_creates_file_when_absent(
    session: AsyncSession, project_with_workspace: tuple[str, Path]
) -> None:
    project_id, workspace = project_with_workspace
    assert not (workspace / "features.md").exists()
    await FeatureService(session).add_feature(project_id, "First", "")
    assert (workspace / "features.md").exists()


async def test_add_feature_appends_multiple_entries(
    session: AsyncSession, project_with_workspace: tuple[str, Path]
) -> None:
    project_id, workspace = project_with_workspace
    svc = FeatureService(session)
    await svc.add_feature(project_id, "Alpha", "Plan A")
    await svc.add_feature(project_id, "Beta", "Plan B")
    content = (workspace / "features.md").read_text(encoding="utf-8")
    headings = [line for line in content.splitlines() if line.startswith("## ")]
    assert headings == ["## Alpha", "## Beta"]


async def test_add_feature_raises_when_project_not_found(session: AsyncSession) -> None:
    with pytest.raises(ValueError, match="not found"):
        await FeatureService(session).add_feature("no-such-project", "Title", "")


async def test_add_feature_raises_when_workspace_missing(
    session: AsyncSession, tmp_path: Path
) -> None:
    row = ProjectRow(
        id="nodir",
        name="No Dir",
        workspace_path=str(tmp_path / "nonexistent"),
        state="idle",
    )
    session.add(row)
    await session.commit()
    with pytest.raises(ValueError, match="does not exist"):
        await FeatureService(session).add_feature("nodir", "Title", "")


# ---------------------------------------------------------------------------
# 3. Chat tool — same write path as the service
# ---------------------------------------------------------------------------


async def test_chat_tool_append_feature_uses_same_format_as_service(
    session: AsyncSession, project_with_workspace: tuple[str, Path]
) -> None:
    """The chat tool and the REST endpoint must produce identical file entries.

    We verify this by:
    1. Calling the tool.
    2. Reading the file it wrote.
    3. Checking the ## heading and body match format_feature_block exactly.
    """
    from orquesta_api.services.chat_tools import ToolExecutor
    from orquesta_api.services.serves import ServeManager

    project_id, workspace = project_with_workspace
    tools = ToolExecutor(session, ServeManager())
    result = await tools.execute(
        "append_feature",
        {"project_id": project_id, "title": "Chat feature", "description": "Via chat."},
    )

    assert result.action == "done"
    assert result.project == project_id
    assert result.payload.get("title") == "Chat feature"

    path = workspace / "features.md"
    content = path.read_text(encoding="utf-8")
    expected_block = format_feature_block("Chat feature", "Via chat.")
    assert expected_block.strip() in content


async def test_chat_tool_append_feature_and_service_produce_same_entry(
    session: AsyncSession, project_with_workspace: tuple[str, Path]
) -> None:
    """Interleaved calls from chat tool and service must both appear correctly."""
    from orquesta_api.services.chat_tools import ToolExecutor
    from orquesta_api.services.serves import ServeManager

    project_id, workspace = project_with_workspace
    tools = ToolExecutor(session, ServeManager())
    svc = FeatureService(session)

    # Add one via service (REST endpoint path), one via chat tool.
    await svc.add_feature(project_id, "REST feature", "From the endpoint.")
    await tools.execute(
        "append_feature",
        {"project_id": project_id, "title": "Chat feature", "description": "From chat."},
    )

    content = (workspace / "features.md").read_text(encoding="utf-8")
    headings = [line for line in content.splitlines() if line.startswith("## ")]
    assert "## REST feature" in headings
    assert "## Chat feature" in headings

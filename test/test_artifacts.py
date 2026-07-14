"""Tests for the artifacts service: safe file listing and reading."""

from pathlib import Path

import pytest

from orquesta_api.services.artifacts import (
    MAX_READ_BYTES,
    ArtifactsService,
    PathTraversalError,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def workspace(tmp_path: Path) -> Path:
    """Minimal workspace with a simulated orq-lite run tree."""
    runs_dir = tmp_path / ".orquestalite" / "runs" / "r20260101T000000Z-abcd"
    runs_dir.mkdir(parents=True)
    (runs_dir / "manifest.json").write_text('{"run_id":"r20260101T000000Z-abcd"}')

    agent_dir = runs_dir / "agents" / "F001" / "coder.c1.a1"
    agent_dir.mkdir(parents=True)
    (agent_dir / "stderr.log").write_text("error: something went wrong\n")
    (agent_dir / "stdout.log").write_text("Running...\nDone.\n")
    (agent_dir / "meta.json").write_text('{"exit_code": 1}')

    # A nested subdir to verify listing shows dirs too
    nested = runs_dir / "agents" / "F001"
    (nested / "attempt.diff").write_text("+ added\n- removed\n")

    return tmp_path


@pytest.fixture
def svc(workspace: Path) -> ArtifactsService:
    return ArtifactsService(workspace_path=str(workspace))


RUN_ID = "r20260101T000000Z-abcd"
AGENT_DIR = ".orquestalite/runs/r20260101T000000Z-abcd/agents/F001/coder.c1.a1"


# ---------------------------------------------------------------------------
# list_dir
# ---------------------------------------------------------------------------


async def test_list_dir_run_root(svc: ArtifactsService) -> None:
    """Listing the run root returns manifest.json and the agents/ entry."""
    listing = await svc.list_dir(
        run_id=RUN_ID,
        subpath="",
    )
    names = {e.name for e in listing.entries}
    assert "manifest.json" in names
    assert "agents" in names


async def test_list_dir_agent_subdir(svc: ArtifactsService) -> None:
    """Listing an agent-level dir returns the expected files."""
    listing = await svc.list_dir(
        run_id=RUN_ID,
        subpath="agents/F001/coder.c1.a1",
    )
    names = {e.name for e in listing.entries}
    assert "stderr.log" in names
    assert "stdout.log" in names
    assert "meta.json" in names


async def test_list_dir_path_traversal_rejected(svc: ArtifactsService) -> None:
    """A subpath containing .. that escapes the run dir is rejected."""
    with pytest.raises(PathTraversalError):
        await svc.list_dir(run_id=RUN_ID, subpath="../../../etc")


async def test_list_dir_path_traversal_via_abs(svc: ArtifactsService) -> None:
    """An absolute subpath is rejected (it could escape the run dir)."""
    with pytest.raises(PathTraversalError):
        await svc.list_dir(run_id=RUN_ID, subpath="/etc/passwd")


async def test_list_dir_symlink_outside_run_rejected(
    svc: ArtifactsService, workspace: Path, tmp_path: Path
) -> None:
    """A symlink pointing outside the run dir is caught at resolution time."""
    run_root = workspace / ".orquestalite" / "runs" / RUN_ID
    outside = tmp_path / "secret.txt"
    outside.write_text("secret")
    symlink = run_root / "evil_link"
    symlink.symlink_to(outside)

    with pytest.raises(PathTraversalError):
        await svc.read_file(run_id=RUN_ID, subpath="evil_link")


# ---------------------------------------------------------------------------
# read_file
# ---------------------------------------------------------------------------


async def test_read_file_content(svc: ArtifactsService) -> None:
    """Reading a file returns its text content."""
    result = await svc.read_file(
        run_id=RUN_ID,
        subpath="agents/F001/coder.c1.a1/stderr.log",
    )
    assert "error: something went wrong" in result.content
    assert result.truncated is False


async def test_read_file_size_cap(svc: ArtifactsService, workspace: Path) -> None:
    """Files larger than MAX_READ_BYTES are truncated at the byte boundary."""
    run_root = workspace / ".orquestalite" / "runs" / RUN_ID
    big = run_root / "big.log"
    big.write_bytes(b"x" * (MAX_READ_BYTES + 100))

    result = await svc.read_file(run_id=RUN_ID, subpath="big.log")
    # The content begins with exactly MAX_READ_BYTES 'x' characters followed
    # by a sentinel; the truncated flag must be True.
    assert result.truncated is True
    assert result.content.startswith("x" * MAX_READ_BYTES)
    assert result.size == MAX_READ_BYTES + 100


async def test_read_file_path_traversal_rejected(svc: ArtifactsService) -> None:
    """A subpath with .. that escapes the run dir is rejected on read."""
    with pytest.raises(PathTraversalError):
        await svc.read_file(run_id=RUN_ID, subpath="../../other_run/manifest.json")


async def test_read_file_not_found_raises(svc: ArtifactsService) -> None:
    """Reading a non-existent path raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        await svc.read_file(run_id=RUN_ID, subpath="does_not_exist.log")


async def test_read_directory_raises(svc: ArtifactsService) -> None:
    """Attempting to read a directory as a file raises IsADirectoryError."""
    with pytest.raises(IsADirectoryError):
        await svc.read_file(run_id=RUN_ID, subpath="agents")

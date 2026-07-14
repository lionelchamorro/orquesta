"""Integration tests for the artifacts browser endpoints.

Verifies:
- Listing the run root returns expected entries.
- Reading a file returns its content.
- Path traversal attempts return HTTP 400.
- Missing project or run dir returns HTTP 404.
"""

from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from orquesta_api.db.session import get_session
from orquesta_api.db.tables import Base, ProjectRow
from orquesta_api.routers.history import router as history_router

RUN_ID = "r20260101T000000Z-test"


@pytest.fixture
async def workspace(tmp_path: Path) -> Path:
    """Create a minimal orq-lite run tree under tmp_path."""
    run_root = tmp_path / ".orquestalite" / "runs" / RUN_ID
    run_root.mkdir(parents=True)
    (run_root / "manifest.json").write_text('{"run_id": "r20260101T000000Z-test"}')
    agent_dir = run_root / "agents" / "F001" / "coder.c1.a1"
    agent_dir.mkdir(parents=True)
    (agent_dir / "stderr.log").write_text("fatal: exit code 1\n")
    return tmp_path


@pytest.fixture
async def db(workspace: Path):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        session.add(
            ProjectRow(
                id="proj1",
                name="test-project",
                workspace_path=str(workspace),
                base_branch="main",
                state="idle",
                cost_usd=0.0,
            )
        )
        session.add(
            ProjectRow(
                id="proj-no-ws",
                name="no-workspace",
                workspace_path=None,
                base_branch="main",
                state="idle",
                cost_usd=0.0,
            )
        )
        await session.commit()
    yield maker
    await engine.dispose()


@pytest.fixture
def app(db: async_sessionmaker[AsyncSession]) -> FastAPI:
    fast = FastAPI()
    fast.include_router(history_router)

    async def _get_session():
        async with db() as s:
            yield s

    fast.dependency_overrides[get_session] = _get_session
    return fast


@pytest.fixture
async def client(app: FastAPI) -> httpx.AsyncClient:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as c:
        yield c


# ---------------------------------------------------------------------------
# Listing tests
# ---------------------------------------------------------------------------


async def test_list_run_root_returns_manifest(client: httpx.AsyncClient) -> None:
    resp = await client.get(f"/projects/proj1/history/runs/{RUN_ID}/artifacts")
    assert resp.status_code == 200
    data = resp.json()
    names = [e["name"] for e in data["entries"]]
    assert "manifest.json" in names
    assert "agents" in names


async def test_list_agent_subdir(client: httpx.AsyncClient) -> None:
    resp = await client.get(
        f"/projects/proj1/history/runs/{RUN_ID}/artifacts",
        params={"path": "agents/F001/coder.c1.a1"},
    )
    assert resp.status_code == 200
    names = [e["name"] for e in resp.json()["entries"]]
    assert "stderr.log" in names


# ---------------------------------------------------------------------------
# Reading tests
# ---------------------------------------------------------------------------


async def test_read_file_content(client: httpx.AsyncClient) -> None:
    resp = await client.get(
        f"/projects/proj1/history/runs/{RUN_ID}/artifacts/file",
        params={"path": "agents/F001/coder.c1.a1/stderr.log"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "fatal: exit code 1" in data["content"]
    assert data["truncated"] is False


# ---------------------------------------------------------------------------
# Path traversal tests
# ---------------------------------------------------------------------------


async def test_path_traversal_via_dotdot_rejected(client: httpx.AsyncClient) -> None:
    resp = await client.get(
        f"/projects/proj1/history/runs/{RUN_ID}/artifacts",
        params={"path": "../../etc"},
    )
    assert resp.status_code == 400


async def test_path_traversal_via_abs_rejected(client: httpx.AsyncClient) -> None:
    resp = await client.get(
        f"/projects/proj1/history/runs/{RUN_ID}/artifacts",
        params={"path": "/etc/passwd"},
    )
    assert resp.status_code == 400


async def test_read_path_traversal_rejected(client: httpx.AsyncClient) -> None:
    resp = await client.get(
        f"/projects/proj1/history/runs/{RUN_ID}/artifacts/file",
        params={"path": "../../other_run/secret.txt"},
    )
    assert resp.status_code == 400


# ---------------------------------------------------------------------------
# Error cases
# ---------------------------------------------------------------------------


async def test_project_not_found_returns_404(client: httpx.AsyncClient) -> None:
    resp = await client.get(f"/projects/does-not-exist/history/runs/{RUN_ID}/artifacts")
    assert resp.status_code == 404


async def test_project_without_workspace_returns_400(client: httpx.AsyncClient) -> None:
    resp = await client.get(
        f"/projects/proj-no-ws/history/runs/{RUN_ID}/artifacts"
    )
    assert resp.status_code == 400


async def test_missing_run_dir_returns_404(client: httpx.AsyncClient) -> None:
    resp = await client.get(
        "/projects/proj1/history/runs/r99999999T000000Z-none/artifacts"
    )
    assert resp.status_code == 404


async def test_read_missing_file_returns_404(client: httpx.AsyncClient) -> None:
    resp = await client.get(
        f"/projects/proj1/history/runs/{RUN_ID}/artifacts/file",
        params={"path": "agents/F001/coder.c1.a1/nope.log"},
    )
    assert resp.status_code == 404

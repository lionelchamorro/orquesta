"""Tests for ServeManager — persistent orq-lite serve per project."""

import asyncio
import stat
import time
from pathlib import Path
from typing import ClassVar

import httpx
import pytest

from orquesta_api.db.tables import ProjectRow
from orquesta_api.services.aggregator import Aggregator, Snapshot
from orquesta_api.services.serves import ServeManager

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _always_healthy(_port: int) -> bool:
    return True


async def _always_unhealthy(_port: int) -> bool:
    return False


def _make_fake_serve_bin(tmp_path: Path) -> str:
    """Return a fake serve binary that stays alive until killed."""
    dst = tmp_path / "orq-lite-serve"
    dst.write_text(
        "#!/usr/bin/env python3\n"
        "import sys, time, json, os\nfrom pathlib import Path\n"
        "log = Path(os.environ.get('FAKE_LOG', 'serve.json'))\n"
        "with log.open('a') as f:\n"
        "    f.write(json.dumps({'argv': sys.argv[1:], 'cwd': str(Path.cwd())}) + '\\n')\n"
        "time.sleep(float(os.environ.get('FAKE_SLEEP_S', '3600')))\n"
    )
    dst.chmod(dst.stat().st_mode | stat.S_IEXEC)
    return str(dst)


# ---------------------------------------------------------------------------
# ServeManager unit tests
# ---------------------------------------------------------------------------


async def test_ensure_spawns_process_and_returns_port(tmp_path: Path) -> None:
    """ensure() starts a process and returns a port > 0."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    bin_path = _make_fake_serve_bin(tmp_path)

    sm = ServeManager(bin_path=bin_path, health_check=_always_healthy)
    try:
        port = await sm.ensure("proj1", str(workspace))
        assert isinstance(port, int)
        assert port > 0
        assert sm.port("proj1") == port
    finally:
        await sm.shutdown()


async def test_ensure_is_idempotent(tmp_path: Path) -> None:
    """Calling ensure() twice returns the same port without spawning a second process."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    bin_path = _make_fake_serve_bin(tmp_path)

    sm = ServeManager(bin_path=bin_path, health_check=_always_healthy)
    try:
        port1 = await sm.ensure("proj1", str(workspace))
        port2 = await sm.ensure("proj1", str(workspace))
        assert port1 == port2
        # Only one process should be tracked
        assert len(sm._processes) == 1
    finally:
        await sm.shutdown()


async def test_port_returns_none_when_not_running() -> None:
    """port() returns None for a project with no serve."""
    sm = ServeManager()
    assert sm.port("unknown") is None


async def test_stop_terminates_process(tmp_path: Path) -> None:
    """stop() terminates the serve process and clears the port."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    bin_path = _make_fake_serve_bin(tmp_path)

    sm = ServeManager(bin_path=bin_path, health_check=_always_healthy)
    await sm.ensure("proj1", str(workspace))
    assert sm.port("proj1") is not None

    await sm.stop("proj1")
    # Port should now be None since process was stopped
    assert sm.port("proj1") is None


async def test_stop_is_idempotent() -> None:
    """stop() on a project with no serve is a no-op."""
    sm = ServeManager()
    # Should not raise
    await sm.stop("nonexistent")


async def test_shutdown_stops_all(tmp_path: Path) -> None:
    """shutdown() stops all managed serve processes."""
    ws1 = tmp_path / "ws1"
    ws1.mkdir()
    ws2 = tmp_path / "ws2"
    ws2.mkdir()
    bin_path = _make_fake_serve_bin(tmp_path)

    sm = ServeManager(bin_path=bin_path, health_check=_always_healthy)
    await sm.ensure("p1", str(ws1))
    await sm.ensure("p2", str(ws2))
    assert len(sm._processes) == 2

    await sm.shutdown()
    assert sm.port("p1") is None
    assert sm.port("p2") is None


async def test_ensure_raises_runtime_error_when_health_check_fails(tmp_path: Path) -> None:
    """ensure() raises RuntimeError when health check never passes."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    bin_path = _make_fake_serve_bin(tmp_path)

    sm = ServeManager(bin_path=bin_path, health_check=_always_unhealthy)
    with pytest.raises(RuntimeError, match="health-check failed"):
        await sm.ensure("proj1", str(workspace))

    # Port cleared after failure
    assert sm.port("proj1") is None


async def test_start_all_starts_serve_per_project(session, tmp_path: Path) -> None:
    """start_all() launches a serve for every project with a workspace."""
    ws1 = tmp_path / "p1"
    ws1.mkdir()
    ws2 = tmp_path / "p2"
    ws2.mkdir()
    bin_path = _make_fake_serve_bin(tmp_path)

    # Register two projects in DB
    p1 = ProjectRow(id="p1", name="P1", workspace_path=str(ws1))
    p2 = ProjectRow(id="p2", name="P2", workspace_path=str(ws2))
    # Project with no workspace: should be skipped
    p3 = ProjectRow(id="p3", name="P3", workspace_path=None)
    session.add_all([p1, p2, p3])
    await session.flush()

    sm = ServeManager(bin_path=bin_path, health_check=_always_healthy)
    try:
        await sm.start_all(session)
        assert sm.port("p1") is not None
        assert sm.port("p2") is not None
        assert sm.port("p3") is None
    finally:
        await sm.shutdown()


async def test_dead_process_triggers_respawn(tmp_path: Path) -> None:
    """If the tracked process is dead, ensure() respawns on a new port."""
    workspace = tmp_path / "ws"
    workspace.mkdir()
    bin_path = _make_fake_serve_bin(tmp_path)

    sm = ServeManager(bin_path=bin_path, health_check=_always_healthy)
    try:
        await sm.ensure("p1", str(workspace))

        # Simulate process death
        proc = sm._processes["p1"]
        proc.terminate()
        await asyncio.wait_for(proc.wait(), timeout=5.0)
        assert proc.returncode is not None

        # Next ensure() detects dead process and respawns
        await sm.ensure("p1", str(workspace))
        assert sm.port("p1") is not None
    finally:
        await sm.shutdown()


# ---------------------------------------------------------------------------
# Aggregator tests — snapshot works without active run
# ---------------------------------------------------------------------------


def _mock_transport_for(tasks: list, features: list, cost: dict) -> httpx.MockTransport:
    """Build a MockTransport that handles the three /api/* endpoints."""

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/api/tasks":
            return httpx.Response(200, json={"tasks": tasks})
        if path == "/api/factory":
            return httpx.Response(200, json={"features": features})
        if path == "/api/cost":
            return httpx.Response(200, json=cost)
        return httpx.Response(404, json={"detail": "not found"})

    return httpx.MockTransport(handler)


async def test_snapshot_returns_empty_when_no_serve(session) -> None:
    """Aggregator.snapshot returns empty Snapshot when ServeManager has no port."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    sm = ServeManager()  # no processes started
    agg = Aggregator(serves=sm, client=OrqLiteClient())
    snap = await agg.snapshot("any-project")
    assert snap == Snapshot()


async def test_snapshot_proxies_from_serve(session) -> None:
    """Aggregator.snapshot fetches tasks/features/cost via MockTransport."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    transport = _mock_transport_for(
        tasks=[{"id": "t1", "title": "Task 1", "status": "pending", "attempts": 0}],
        features=[{"id": "f1", "title": "F1", "status": "pending"}],
        cost={"available": True, "total_usd": 1.5},
    )

    # Patch ServeManager to claim port 9999 is live
    sm = ServeManager()
    sm._ports["proj"] = 9999
    sm._processes["proj"] = _FakeAliveProcess()

    agg = Aggregator(serves=sm, client=OrqLiteClient(transport=transport))
    snap = await agg.snapshot("proj")

    assert len(snap.tasks) == 1
    assert snap.tasks[0].id == "t1"
    assert len(snap.features) == 1
    assert snap.cost.available is True
    assert snap.cost.total_usd == 1.5


async def test_snapshot_fetches_tasks_factory_and_cost_concurrently() -> None:
    """Aggregator.snapshot should pay one serve round trip, not three serial waits."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    class SlowClient(OrqLiteClient):
        _empty_tasks: ClassVar[dict[str, object]] = {"tasks": []}
        _empty_factory: ClassVar[dict[str, object]] = {"features": []}
        _cost: ClassVar[dict[str, object]] = {"available": True, "total_usd": 2.0}

        # ast-grep-ignore: no-dict-return-annotation
        async def get_tasks(self, base_url: str) -> dict:
            await asyncio.sleep(0.05)
            return self._empty_tasks

        # ast-grep-ignore: no-dict-return-annotation
        async def get_factory(self, base_url: str) -> dict:
            await asyncio.sleep(0.05)
            return self._empty_factory

        # ast-grep-ignore: no-dict-return-annotation
        async def get_cost(self, base_url: str) -> dict:
            await asyncio.sleep(0.05)
            return self._cost

    sm = ServeManager()
    sm._ports["proj"] = 9999
    sm._processes["proj"] = _FakeAliveProcess()

    started = time.perf_counter()
    snap = await Aggregator(serves=sm, client=SlowClient()).snapshot("proj")
    elapsed = time.perf_counter() - started

    assert snap.cost.total_usd == 2.0
    assert elapsed < 0.12


async def test_snapshot_preserves_runtime_error_type_from_serve() -> None:
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    class FailingClient(OrqLiteClient):
        _empty_factory: ClassVar[dict[str, object]] = {"features": []}
        _empty_cost: ClassVar[dict[str, object]] = {"available": True, "total_usd": 2.0}

        # ast-grep-ignore: no-dict-return-annotation
        async def get_tasks(self, base_url: str) -> dict:
            raise RuntimeError("serve unavailable")

        # ast-grep-ignore: no-dict-return-annotation
        async def get_factory(self, base_url: str) -> dict:
            await asyncio.sleep(0)
            return self._empty_factory

        # ast-grep-ignore: no-dict-return-annotation
        async def get_cost(self, base_url: str) -> dict:
            await asyncio.sleep(0)
            return self._empty_cost

    sm = ServeManager()
    sm._ports["proj"] = 9999
    sm._processes["proj"] = _FakeAliveProcess()

    with pytest.raises(RuntimeError, match="serve unavailable"):
        await Aggregator(serves=sm, client=FailingClient()).snapshot("proj")


async def test_get_diff_raises_when_no_serve() -> None:
    """get_diff raises ValueError (→ 404) when no serve is running."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    sm = ServeManager()
    agg = Aggregator(serves=sm, client=OrqLiteClient())
    with pytest.raises(ValueError, match="not found"):
        await agg.get_diff("proj", "task-1")


async def test_get_result_raises_when_no_serve() -> None:
    """get_result raises ValueError (→ 404) when no serve is running."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    sm = ServeManager()
    agg = Aggregator(serves=sm, client=OrqLiteClient())
    with pytest.raises(ValueError, match="not found"):
        await agg.get_result("proj", "dev")


# ---------------------------------------------------------------------------
# OrqLiteClient transport injection
# ---------------------------------------------------------------------------


async def test_orq_lite_client_accepts_transport() -> None:
    """OrqLiteClient passes transport to httpx.AsyncClient."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"tasks": []})

    transport = httpx.MockTransport(handler)
    client = OrqLiteClient(transport=transport)
    result = await client.get_tasks("http://localhost:9999")
    assert result == {"tasks": []}


async def test_orq_lite_client_maps_http_status_error_to_runtime_error() -> None:
    """A non-2xx response (orq-lite 404s an unknown role) maps to RuntimeError, not a raw 500."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="not found")

    client = OrqLiteClient(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="404"):
        await client.get_tasks("http://localhost:9999")


async def test_orq_lite_client_maps_connection_error_to_runtime_error() -> None:
    """A transport-level failure (server unreachable) also maps to RuntimeError."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    client = OrqLiteClient(transport=httpx.MockTransport(handler))
    with pytest.raises(RuntimeError, match="request failed"):
        await client.get_tasks("http://localhost:9999")


async def test_orq_lite_client_reuses_the_same_underlying_client() -> None:
    """The httpx.AsyncClient is created once and reused across calls, not per-request."""
    from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"tasks": []})

    client = OrqLiteClient(transport=httpx.MockTransport(handler))
    await client.get_tasks("http://localhost:9999")
    first = client._client
    await client.get_factory("http://localhost:9999")
    assert client._client is first

    await client.aclose()
    assert client._client.is_closed


# ---------------------------------------------------------------------------
# Internal helper: fake alive process
# ---------------------------------------------------------------------------


class _FakeAliveProcess:
    """Minimal stand-in for asyncio.subprocess.Process with returncode=None (alive)."""

    returncode: int | None = None

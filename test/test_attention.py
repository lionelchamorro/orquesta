"""Tests for the needs-attention aggregation endpoint."""

from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import httpx

from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient
from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import (
    AttentionKind,
    AttentionResponse,
    Container,
    RunHandle,
    RunKind,
    RunSpec,
    RunState,
)
from orquesta_api.routers.attention import get_attention
from orquesta_api.services.attention import AttentionService
from orquesta_api.services.serves import ServeManager


class FakeLogExecutor(ExecutorInterface):
    """Executor fake that returns persisted log tail lines by run id."""

    def __init__(self, logs_by_run: dict[str, list[str]] | None = None) -> None:
        self._logs_by_run = logs_by_run or {}

    async def start(self, spec: RunSpec, run_id: str = "") -> RunHandle:
        return RunHandle(run_id=run_id)

    async def stop(self, handle: RunHandle, grace_s: int = 10) -> None:
        return None

    async def status(self, handle: RunHandle) -> RunState:
        return RunState.failed

    async def wait(self, handle: RunHandle) -> int:
        return 1

    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]:
        return self._logs(handle, tail)

    async def _logs(self, handle: RunHandle, tail: int | None) -> AsyncIterator[str]:
        lines = self._logs_by_run.get(handle.run_id or "", [])
        if tail is not None:
            lines = lines[-tail:]
        for line in lines:
            yield line

    async def inspect(self, handle: RunHandle) -> Container | None:
        return None


class FakeAliveProcess:
    """Minimal stand-in for asyncio.subprocess.Process with returncode=None."""

    returncode: int | None = None


def _client_for_tasks(tasks: list[dict[str, object]]) -> OrqLiteClient:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/api/tasks":
            return httpx.Response(200, json={"tasks": tasks})
        if request.url.path == "/api/factory":
            return httpx.Response(200, json={"features": []})
        if request.url.path == "/api/cost":
            return httpx.Response(200, json={"available": True, "total_usd": 0})
        return httpx.Response(404, json={"detail": "not found"})

    return OrqLiteClient(transport=httpx.MockTransport(handler))


async def test_attention_aggregates_failed_run_and_task_items_sorted_newest_first(
    session,
) -> None:
    older = datetime.now(tz=UTC) - timedelta(minutes=5)
    newer = datetime.now(tz=UTC)
    session.add(
        ProjectRow(
            id="proj1",
            name="Project",
            workspace_path="/workspace",
            state="needs_human",
            last_run=newer,
        )
    )
    session.add(
        RunRow(
            id="run1",
            project_id="proj1",
            kind=RunKind.flow.value,
            state=RunState.failed.value,
            executor="local",
            created_at=older,
            finished_at=older,
            flow="pr_review",
            error="tests failed",
        )
    )
    await session.commit()

    serves = ServeManager()
    serves._ports["proj1"] = 9999
    serves._processes["proj1"] = FakeAliveProcess()
    client = _client_for_tasks(
        [
            {
                "id": "task-human",
                "title": "Fix auth",
                "status": "needs_human",
                "attempts": 2,
                "failure_reason": "tests failed",
            },
            {
                "id": "task-clarify",
                "title": "Clarify scope",
                "status": "needs_clarification",
                "attempts": 1,
                "failure_reason": "missing acceptance criteria",
            },
            {
                "id": "task-ok",
                "title": "Already done",
                "status": "done",
                "attempts": 1,
            },
        ]
    )
    executor = FakeLogExecutor({"run1": ["line one", "line two"]})

    response = await AttentionService(session, serves, client=client, executor=executor).list()

    assert [item.kind for item in response.items] == [
        AttentionKind.task_needs_human,
        AttentionKind.task_needs_clarification,
        AttentionKind.run_failed,
    ]
    assert [set(item.model_dump().keys()) for item in response.items] == [
        {"kind", "project_id", "project_name", "ref", "title", "detail", "ts"},
        {"kind", "project_id", "project_name", "ref", "title", "detail", "ts"},
        {"kind", "project_id", "project_name", "ref", "title", "detail", "ts"},
    ]
    run_item = response.items[-1]
    assert run_item.ref == "run1"
    assert run_item.title == "pr_review failed"
    assert run_item.detail == "tests failed\nline one\nline two"
    assert response.items[0].ref == "task-human"
    assert response.items[0].detail == "tests failed"


async def test_attention_ignores_unreachable_serve_and_keeps_run_items(session) -> None:
    now = datetime.now(tz=UTC)
    session.add(
        ProjectRow(
            id="proj1",
            name="Project",
            workspace_path="/workspace",
            state="needs_human",
            last_run=now,
        )
    )
    session.add(
        RunRow(
            id="run1",
            project_id="proj1",
            kind=RunKind.run.value,
            state=RunState.failed.value,
            executor="local",
            created_at=now,
            finished_at=now,
            error="failed",
        )
    )
    await session.commit()

    serves = ServeManager()
    serves._ports["proj1"] = 9999
    serves._processes["proj1"] = FakeAliveProcess()

    def handler(_request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("serve down")

    response = await AttentionService(
        session,
        serves,
        client=OrqLiteClient(transport=httpx.MockTransport(handler)),
        executor=FakeLogExecutor(),
    ).list()

    assert len(response.items) == 1
    assert response.items[0].kind == AttentionKind.run_failed
    assert response.items[0].ref == "run1"


async def test_attention_endpoint_returns_response_contract(session) -> None:
    now = datetime.now(tz=UTC)
    session.add(
        ProjectRow(
            id="proj1",
            name="Project",
            workspace_path="/workspace",
            state="needs_human",
            last_run=now,
        )
    )
    session.add(
        RunRow(
            id="run1",
            project_id="proj1",
            kind=RunKind.run.value,
            state=RunState.failed.value,
            executor="local",
            created_at=now,
            finished_at=now,
            error="failed",
        )
    )
    await session.commit()

    response = await get_attention(session, ServeManager(), FakeLogExecutor())

    assert isinstance(response, AttentionResponse)
    assert response.items[0].model_dump() == {
        "kind": AttentionKind.run_failed,
        "project_id": "proj1",
        "project_name": "Project",
            "ref": "run1",
            "title": "run failed",
            "detail": "failed",
            "ts": now.replace(tzinfo=None).isoformat(),
        }

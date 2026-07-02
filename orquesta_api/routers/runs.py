"""Run lifecycle endpoints."""

import asyncio
from collections.abc import AsyncGenerator, AsyncIterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Run, RunKind, RunState
from orquesta_api.services.runs import RunSupervisor, _make_executor

router = APIRouter(tags=["runs"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

HEARTBEAT_INTERVAL_S: float = 15.0


def _get_executor() -> ExecutorInterface:
    return _make_executor()


ExecutorDep = Annotated[ExecutorInterface, Depends(_get_executor)]


class RunCreate(BaseModel):
    """Request body for POST /projects/{project_id}/runs."""

    kind: RunKind
    plan_path: str | None = None
    flow: str | None = None
    inputs: dict[str, str] = Field(default_factory=dict)
    args: list[str] = Field(default_factory=list)


async def _event_stream(log_iter: AsyncIterator[str], is_tail: bool) -> AsyncGenerator[str, None]:
    """Wrap log lines as SSE events; heartbeat on idle for live streams."""
    if is_tail:
        async for line in log_iter:
            yield f"data: {line}\n\n"
        return
    # Keep a persistent Future so timeouts never cancel/finalise the underlying generator.
    future: asyncio.Task[str] = asyncio.ensure_future(anext(log_iter))
    while True:
        done, _ = await asyncio.wait({future}, timeout=HEARTBEAT_INTERVAL_S)
        if not done:
            yield ": heartbeat\n\n"
            continue
        try:
            line = future.result()
        except StopAsyncIteration:
            break
        yield f"data: {line}\n\n"
        future = asyncio.ensure_future(anext(log_iter))


@router.post("/projects/{project_id}/runs")
async def launch_run(
    project_id: str, body: RunCreate, session: SessionDep, executor: ExecutorDep
) -> Run:
    """Start a new run for the project."""
    svc = RunSupervisor(session, executor=executor)
    return await svc.launch(
        project_id,
        kind=body.kind,
        plan_path=body.plan_path,
        flow=body.flow,
        inputs=body.inputs,
        args=body.args,
    )


@router.get("/runs")
async def list_runs(
    session: SessionDep,
    project: Annotated[str | None, Query()] = None,
    state: Annotated[RunState | None, Query()] = None,
) -> list[Run]:
    """Return runs with optional project and state filters."""
    svc = RunSupervisor(session)
    return await svc.list(project_id=project, state=state)


@router.get("/runs/{run_id}/logs")
async def stream_run_logs(
    run_id: str,
    session: SessionDep,
    executor: ExecutorDep,
    tail: Annotated[int | None, Query(ge=0)] = None,
) -> StreamingResponse:
    """Stream stdout log lines for a run as SSE events."""
    svc = RunSupervisor(session, executor=executor)
    run, handle = await svc.get_stream_context(run_id)

    if run.pid is None:
        raise HTTPException(status_code=410, detail=f"Run '{run_id}' has no process handle yet")

    log_iter = svc.executor.logs(handle, tail=tail)
    return StreamingResponse(
        _event_stream(log_iter, is_tail=tail is not None), media_type="text/event-stream"
    )


@router.get("/runs/{run_id}")
async def get_run(run_id: str, session: SessionDep) -> Run:
    """Return a single run by id."""
    svc = RunSupervisor(session)
    return await svc.get(run_id)


@router.post("/runs/{run_id}/stop")
async def stop_run(run_id: str, session: SessionDep) -> Run:
    """Stop a running process and transition it to a terminal state."""
    svc = RunSupervisor(session)
    return await svc.stop(run_id)

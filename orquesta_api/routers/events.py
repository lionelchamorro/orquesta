"""Aggregated SSE endpoints: global event feed and per-project event feed."""

import asyncio
from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from orquesta_api.services.events import EventBus

router = APIRouter(tags=["events"])

HEARTBEAT_INTERVAL_S: float = 15.0


def _get_event_bus(request: Request) -> EventBus:
    """FastAPI dependency: read the EventBus from app.state.events."""
    return request.app.state.events  # type: ignore[no-any-return]


EventBusDep = Annotated[EventBus, Depends(_get_event_bus)]


async def _sse_stream(bus: EventBus, project_id: str | None) -> AsyncGenerator[str, None]:
    async with bus.subscribe(project_id) as queue:
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=HEARTBEAT_INTERVAL_S)
            except TimeoutError:
                yield ": heartbeat\n\n"
                continue
            yield f"data: {event.model_dump_json()}\n\n"


@router.get("/events")
async def stream_events(bus: EventBusDep) -> StreamingResponse:
    """Stream every lifecycle event across all projects."""
    return StreamingResponse(_sse_stream(bus, project_id=None), media_type="text/event-stream")


@router.get("/projects/{project_id}/events")
async def stream_project_events(project_id: str, bus: EventBusDep) -> StreamingResponse:
    """Stream lifecycle events scoped to a single project."""
    return StreamingResponse(
        _sse_stream(bus, project_id=project_id), media_type="text/event-stream"
    )

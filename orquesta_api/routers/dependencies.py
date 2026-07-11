"""Shared FastAPI dependency callables for all routers.

Centralises the small-but-repeated DI helpers that every router used to
define locally: the executor singleton, the serve-manager accessor, and the
event-ingest accessor.  Session wiring stays per-router (one-liner; no
shared logic) to avoid pulling in every router's import surface here.
"""

from typing import Annotated

from fastapi import Depends, Request

from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.services.events import EventIngestManager
from orquesta_api.services.runs import make_executor
from orquesta_api.services.serves import ServeManager


def get_executor() -> ExecutorInterface:
    """Return the process-wide executor singleton."""
    return make_executor()


def get_serves(request: Request) -> ServeManager:
    """Return the ServeManager from app.state."""
    return request.app.state.serves  # type: ignore[no-any-return]


def get_ingest(request: Request) -> EventIngestManager:
    """Return the EventIngestManager from app.state."""
    return request.app.state.ingest  # type: ignore[no-any-return]


ExecutorDep = Annotated[ExecutorInterface, Depends(get_executor)]
ServesDep = Annotated[ServeManager, Depends(get_serves)]
IngestDep = Annotated[EventIngestManager, Depends(get_ingest)]

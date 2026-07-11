"""FastAPI application factory for orquesta_api."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware

from orquesta_api.core.auth import bearer_auth_middleware, startup_check
from orquesta_api.db.migrations import ensure_schema_current
from orquesta_api.db.session import SessionLocal, engine
from orquesta_api.db.tables import ProjectRow
from orquesta_api.logger import get_logger
from orquesta_api.routers.attention import router as attention_router
from orquesta_api.routers.chat import router as chat_router
from orquesta_api.routers.containers import images_router
from orquesta_api.routers.containers import router as containers_router
from orquesta_api.routers.events import router as events_router
from orquesta_api.routers.flows import router as flows_router
from orquesta_api.routers.history import router as history_router
from orquesta_api.routers.projects import router as projects_router
from orquesta_api.routers.repos import router as repos_router
from orquesta_api.routers.runs import router as runs_router
from orquesta_api.routers.skills import router as skills_router
from orquesta_api.routers.teams import router as teams_router
from orquesta_api.routers.webhooks import router as webhooks_router
from orquesta_api.services.correlation import RunCorrelator
from orquesta_api.services.events import EventIngestManager, get_event_bus
from orquesta_api.services.repos import CloneTargetError, RunInFlightError, WorkspaceDirtyError
from orquesta_api.services.runs import RunSupervisor, make_executor
from orquesta_api.services.serves import ServeManager

logger = get_logger(__name__)


class HealthResponse(BaseModel):
    """Response body for GET /health."""

    status: str = "ok"


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    await ensure_schema_current(engine)
    logger.info("Database schema check complete => startup continuing")

    # Reconcile any runs that were active when the API last shut down.
    # Must run before serving requests so stale "running" rows are cleaned up.
    async with SessionLocal() as session:
        supervisor = RunSupervisor(session, executor=make_executor())
        await supervisor.reconcile()

    serves = ServeManager()
    app.state.serves = serves
    events = get_event_bus()
    app.state.events = events
    ingest = EventIngestManager(events, serves.port)
    app.state.ingest = ingest
    correlator = RunCorrelator(events, SessionLocal)
    correlator.start()

    async with SessionLocal() as session:
        await serves.start_all(session)
        projects = await session.execute(select(ProjectRow))
        for row in projects.scalars():
            if row.workspace_path:
                ingest.start(row.id)

    try:
        yield
    finally:
        await correlator.shutdown()
        await ingest.shutdown()
        await serves.shutdown()


def _register_exception_handlers(app: FastAPI) -> None:
    """Wire all exception handlers onto app."""

    @app.exception_handler(ValueError)
    async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
        if "not found" in str(exc).lower():
            return JSONResponse(status_code=404, content={"detail": str(exc)})
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    @app.exception_handler(FileExistsError)
    async def file_exists_handler(_request: Request, exc: FileExistsError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(CloneTargetError)
    async def clone_target_handler(_request: Request, exc: CloneTargetError) -> JSONResponse:
        return JSONResponse(status_code=422, content={"detail": str(exc)})

    @app.exception_handler(WorkspaceDirtyError)
    async def workspace_dirty_handler(_request: Request, exc: WorkspaceDirtyError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(RunInFlightError)
    async def run_in_flight_handler(_request: Request, exc: RunInFlightError) -> JSONResponse:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    @app.exception_handler(RuntimeError)
    async def runtime_error_handler(_request: Request, exc: RuntimeError) -> JSONResponse:
        return JSONResponse(status_code=502, content={"detail": str(exc)})

    @app.exception_handler(NotImplementedError)
    async def not_implemented_handler(_request: Request, exc: NotImplementedError) -> JSONResponse:
        return JSONResponse(status_code=501, content={"detail": str(exc)})

    @app.exception_handler(PermissionError)
    async def permission_error_handler(_request: Request, exc: PermissionError) -> JSONResponse:
        return JSONResponse(status_code=401, content={"detail": str(exc)})


def create_app() -> FastAPI:
    """Return a configured FastAPI instance."""
    startup_check()

    app = FastAPI(lifespan=_lifespan)
    app.add_middleware(BaseHTTPMiddleware, dispatch=bearer_auth_middleware)

    app.include_router(projects_router)
    app.include_router(flows_router)
    app.include_router(teams_router)
    app.include_router(repos_router)
    app.include_router(runs_router)
    app.include_router(skills_router)
    app.include_router(events_router)
    app.include_router(attention_router)
    app.include_router(chat_router)
    app.include_router(webhooks_router)
    app.include_router(containers_router)
    app.include_router(images_router)
    app.include_router(history_router)

    @app.get("/health")
    async def health() -> HealthResponse:
        return HealthResponse()

    _register_exception_handlers(app)

    return app

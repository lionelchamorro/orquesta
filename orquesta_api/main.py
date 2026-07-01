"""FastAPI application factory for orquesta_api."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from orquesta_api.db.session import engine
from orquesta_api.db.tables import Base
from orquesta_api.logger import get_logger
from orquesta_api.routers.flows import router as flows_router
from orquesta_api.routers.projects import router as projects_router
from orquesta_api.routers.repos import router as repos_router
from orquesta_api.routers.runs import router as runs_router
from orquesta_api.routers.teams import router as teams_router
from orquesta_api.services.repos import CloneTargetError, RunInFlightError, WorkspaceDirtyError

logger = get_logger(__name__)


@asynccontextmanager
async def _lifespan(_app: FastAPI) -> AsyncIterator[None]:
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables created => startup complete")
    yield


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
    app = FastAPI(lifespan=_lifespan)

    app.include_router(projects_router)
    app.include_router(flows_router)
    app.include_router(teams_router)
    app.include_router(repos_router)
    app.include_router(runs_router)

    @app.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    _register_exception_handlers(app)

    return app

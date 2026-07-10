"""Needs-attention aggregation endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import AttentionResponse
from orquesta_api.services.attention import AttentionService
from orquesta_api.services.runs import _make_executor
from orquesta_api.services.serves import ServeManager

router = APIRouter(tags=["attention"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _get_serves(request: Request) -> ServeManager:
    """FastAPI dependency: read ServeManager from app.state.serves."""
    return request.app.state.serves  # type: ignore[no-any-return]


def _get_executor() -> ExecutorInterface:
    return _make_executor()


ServesDep = Annotated[ServeManager, Depends(_get_serves)]
ExecutorDep = Annotated[ExecutorInterface, Depends(_get_executor)]


@router.get("/attention")
async def get_attention(
    session: SessionDep,
    serves: ServesDep,
    executor: ExecutorDep,
) -> AttentionResponse:
    """Return needs-attention items across projects."""
    return await AttentionService(session, serves, executor=executor).list()

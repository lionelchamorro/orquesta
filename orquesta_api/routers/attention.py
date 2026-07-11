"""Needs-attention aggregation endpoint."""

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.meta.models import AttentionResponse
from orquesta_api.routers.dependencies import ExecutorDep, ServesDep
from orquesta_api.services.attention import AttentionService

router = APIRouter(tags=["attention"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/attention")
async def get_attention(
    session: SessionDep,
    serves: ServesDep,
    executor: ExecutorDep,
) -> AttentionResponse:
    """Return needs-attention items across projects."""
    return await AttentionService(session, serves, executor=executor).list()

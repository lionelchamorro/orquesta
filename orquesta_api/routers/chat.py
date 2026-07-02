"""Centralized admin chat endpoints: POST /chat (SSE) and GET /chat/history."""

from typing import Annotated, Literal, cast

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.config import settings
from orquesta_api.db.session import get_session
from orquesta_api.meta.models import ChatMessage
from orquesta_api.services.chat import (
    DEFAULT_CONVERSATION_ID,
    AnthropicChatModel,
    ChatModel,
    ChatService,
    get_history,
)
from orquesta_api.services.chat_tools import ToolExecutor
from orquesta_api.services.serves import ServeManager

router = APIRouter(prefix="/chat", tags=["chat"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_CHAT_MODEL: ChatModel | None = None


def _get_serves(request: Request) -> ServeManager:
    return request.app.state.serves  # type: ignore[no-any-return]


ServesDep = Annotated[ServeManager, Depends(_get_serves)]


def _make_chat_model() -> ChatModel:
    """Process-wide AnthropicChatModel singleton, matching the executor/event-bus pattern."""
    global _CHAT_MODEL
    if _CHAT_MODEL is None:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key.get_secret_value())
        _CHAT_MODEL = AnthropicChatModel(client, settings.chat_model)
    return _CHAT_MODEL


class ChatRequest(BaseModel):
    """Request body for POST /chat."""

    message: str
    conversation_id: str = DEFAULT_CONVERSATION_ID


@router.post("")
async def post_chat(body: ChatRequest, session: SessionDep, serves: ServesDep) -> StreamingResponse:
    """Run one chat turn and stream text/tool-call/done events as SSE."""
    tools = ToolExecutor(session, serves)
    service = ChatService(session, tools, _make_chat_model())
    return StreamingResponse(
        service.send(body.message, body.conversation_id), media_type="text/event-stream"
    )


@router.get("/history")
async def get_chat_history(
    session: SessionDep,
    conversation_id: Annotated[str, Query()] = DEFAULT_CONVERSATION_ID,
) -> list[ChatMessage]:
    """Return the persisted message history for a conversation."""
    rows = await get_history(session, conversation_id)
    return [
        ChatMessage(
            id=row.id,
            # Only ChatService writes these rows and it only writes the two
            # literal roles; the DB column is a plain str, hence the cast.
            role=cast(Literal["user", "assistant"], row.role),
            content=row.content,
            project=row.project,
            action=row.action,
        )
        for row in rows
    ]

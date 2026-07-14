"""Centralized admin chat: tool-use over the control plane's own services.

ChatModel is a narrow protocol (stream_turn) so the Anthropic SDK's actual
wire format is isolated to AnthropicChatModel; ChatService's tool-use loop
and persistence logic are tested against a fake model that yields canned
events, with no network access required.
"""

import json
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.tables import ChatMessageRow, ConversationRow
from orquesta_api.logger import get_logger
from orquesta_api.services.chat_tools import TOOL_SCHEMAS, ToolExecutor

logger = get_logger(__name__)

DEFAULT_CONVERSATION_ID = "default"
MAX_TOOL_ROUNDS = 6

_SYSTEM_PROMPT_BASE = (
    "You are the orquesta admin assistant, embedded in a multi-project control "
    "plane for the orq-lite delivery engine. Use the tools to look up real state "
    "before answering — never fabricate project status, run results, or ids. "
    "Ask a clarifying question when the target project is ambiguous."
)


def build_system_prompt(project_id: str | None = None) -> str:
    """Return the system prompt, optionally scoped to an active project.

    When ``project_id`` is provided the prompt is extended with a context
    line that tells the assistant which project is currently in scope so the
    user does not need to name it on every message.
    """
    if project_id:
        return (
            f"{_SYSTEM_PROMPT_BASE}\n\n"
            f"Active project context: {project_id}. "
            "Prefer this project when the user's request is project-specific "
            "and no other project is explicitly named."
        )
    return _SYSTEM_PROMPT_BASE


@dataclass
class TextDelta:
    text: str


@dataclass
class ToolUse:
    id: str
    name: str
    input: dict[str, Any]


@dataclass
class Stop:
    stop_reason: str | None


StreamEvent = TextDelta | ToolUse | Stop


class ChatModel(Protocol):
    def stream_turn(
        self, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> AsyncIterator[StreamEvent]: ...


class AnthropicChatModel:
    """Adapts anthropic.AsyncAnthropic's streaming Messages API to ChatModel."""

    def __init__(self, client: Any, model: str) -> None:
        self._client = client
        self._model = model

    async def stream_turn(
        self, system: str, messages: list[dict[str, Any]], tools: list[dict[str, Any]]
    ) -> AsyncIterator[StreamEvent]:
        async with self._client.messages.stream(
            model=self._model,
            max_tokens=4096,
            system=system,
            messages=messages,
            tools=tools,
        ) as stream:
            async for event in stream:
                if event.type == "content_block_delta" and event.delta.type == "text_delta":
                    yield TextDelta(event.delta.text)
            final = await stream.get_final_message()
            for block in final.content:
                if block.type == "tool_use":
                    yield ToolUse(id=block.id, name=block.name, input=block.input)
            yield Stop(stop_reason=final.stop_reason)


def _sse(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def get_history(
    session: AsyncSession, conversation_id: str = DEFAULT_CONVERSATION_ID
) -> list[ChatMessageRow]:
    """Read-only history query — does not need a ChatModel or ToolExecutor."""
    result = await session.execute(
        select(ChatMessageRow)
        .where(ChatMessageRow.conversation_id == conversation_id)
        .order_by(ChatMessageRow.created_at)
    )
    return list(result.scalars().all())


class ChatService:
    """Runs one chat turn: tool-use loop over the model, streamed as SSE, persisted."""

    def __init__(self, session: AsyncSession, tools: ToolExecutor, model: ChatModel) -> None:
        self._session = session
        self._tools = tools
        self._model = model

    async def history(self, conversation_id: str = DEFAULT_CONVERSATION_ID) -> list[ChatMessageRow]:
        return await get_history(self._session, conversation_id)

    async def send(
        self,
        user_text: str,
        conversation_id: str = DEFAULT_CONVERSATION_ID,
        project_id: str | None = None,
    ) -> AsyncIterator[str]:
        """Yield SSE-formatted event strings for one chat turn.

        ``project_id`` scopes the system prompt to a specific project so the
        assistant does not ask for clarification when the active project is
        already known from the chat context.
        """
        await self._ensure_conversation(conversation_id)
        await self._persist(conversation_id, role="user", content=user_text)

        messages: list[dict[str, Any]] = [
            {"role": row.role, "content": row.content}
            for row in await self.history(conversation_id)
        ]

        system_prompt = build_system_prompt(project_id)
        assistant_text = ""
        action: str | None = None
        project: str | None = project_id

        for _round in range(MAX_TOOL_ROUNDS):
            tool_uses: list[ToolUse] = []
            async for event in self._model.stream_turn(system_prompt, messages, TOOL_SCHEMAS):
                if isinstance(event, TextDelta):
                    assistant_text += event.text
                    yield _sse({"type": "text", "text": event.text})
                elif isinstance(event, ToolUse):
                    tool_uses.append(event)

            if not tool_uses:
                break

            messages.append(
                {
                    "role": "assistant",
                    "content": [
                        {"type": "tool_use", "id": t.id, "name": t.name, "input": t.input}
                        for t in tool_uses
                    ],
                }
            )
            tool_result_blocks = []
            for tool_use in tool_uses:
                result = await self._tools.execute(tool_use.name, tool_use.input)
                action = result.action or action
                project = result.project or project
                yield _sse({"type": "tool_call", "name": tool_use.name, "input": tool_use.input})
                tool_result_blocks.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use.id,
                        "content": json.dumps(result.payload),
                    }
                )
            messages.append({"role": "user", "content": tool_result_blocks})
        else:
            logger.warning(
                "Chat turn hit MAX_TOOL_ROUNDS=%d without a final answer", MAX_TOOL_ROUNDS
            )

        await self._persist(
            conversation_id,
            role="assistant",
            content=assistant_text,
            action=action,
            project=project,
        )
        yield _sse({"type": "done", "action": action, "project": project})

    async def _ensure_conversation(self, conversation_id: str) -> None:
        existing = await self._session.get(ConversationRow, conversation_id)
        if existing is None:
            self._session.add(ConversationRow(id=conversation_id, created_at=datetime.now(tz=UTC)))
            await self._session.flush()

    async def _persist(
        self,
        conversation_id: str,
        role: str,
        content: str,
        action: str | None = None,
        project: str | None = None,
    ) -> None:
        self._session.add(
            ChatMessageRow(
                id=str(uuid.uuid4()),
                conversation_id=conversation_id,
                role=role,
                content=content,
                action=action,
                project=project,
                created_at=datetime.now(tz=UTC),
            )
        )
        await self._session.commit()

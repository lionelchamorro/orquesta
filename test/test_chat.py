"""Task 11: ChatService tool-use loop and ToolExecutor dispatch.

ChatService is tested against a FakeChatModel that yields canned
TextDelta/ToolUse events — no network access to the real Anthropic API is
needed or used.
"""

from pathlib import Path

import pytest

from orquesta_api.db.tables import ProjectRow
from orquesta_api.services.chat import (
    ChatService,
    Stop,
    TextDelta,
    ToolUse,
    build_system_prompt,
    get_history,
)
from orquesta_api.services.chat_tools import ToolExecutor
from orquesta_api.services.serves import ServeManager


class FakeChatModel:
    """Replays a fixed sequence of turns, each a list of StreamEvents."""

    def __init__(self, turns: list[list]) -> None:
        self._turns = turns
        self.calls: list[list[dict]] = []

    async def stream_turn(self, system, messages, tools):
        self.calls.append(messages)
        turn = self._turns[len(self.calls) - 1]
        for event in turn:
            yield event


@pytest.fixture
async def project_id(session, tmp_path: Path) -> str:
    row = ProjectRow(id="atlas", name="Atlas", workspace_path=str(tmp_path / "atlas"), state="idle")
    session.add(row)
    await session.commit()
    return "atlas"


async def test_plain_text_reply_with_no_tool_calls(session) -> None:
    model = FakeChatModel([[TextDelta("Hello there."), Stop(stop_reason="end_turn")]])
    tools = ToolExecutor(session, ServeManager())
    service = ChatService(session, tools, model)

    events = [e async for e in service.send("hi")]
    joined = "".join(events)
    assert '"type": "text"' in joined
    assert '"type": "done"' in joined

    history = await get_history(session)
    assert [h.role for h in history] == ["user", "assistant"]
    assert history[1].content == "Hello there."


async def test_tool_call_round_trip_persists_action_and_project(session, project_id: str) -> None:
    model = FakeChatModel(
        [
            [ToolUse(id="t1", name="list_projects", input={}), Stop(stop_reason="tool_use")],
            [TextDelta("Atlas is idle."), Stop(stop_reason="end_turn")],
        ]
    )
    tools = ToolExecutor(session, ServeManager())
    service = ChatService(session, tools, model)

    events = [e async for e in service.send("what projects do I have?")]
    joined = "".join(events)
    assert '"type": "tool_call"' in joined
    assert '"name": "list_projects"' in joined

    # Second model call must have received the tool_use + tool_result messages.
    assert len(model.calls) == 2
    second_call_messages = model.calls[1]
    assert second_call_messages[-2]["role"] == "assistant"
    assert second_call_messages[-1]["role"] == "user"
    assert second_call_messages[-1]["content"][0]["type"] == "tool_result"

    history = await get_history(session)
    assert history[-1].content == "Atlas is idle."


async def test_get_project_status_tool_reports_real_state(session, project_id: str) -> None:
    tools = ToolExecutor(session, ServeManager())
    result = await tools.execute("get_project_status", {"project_id": project_id})
    assert result.project == project_id
    assert result.payload["state"] == "idle"
    assert result.payload["tasks_total"] == 0


async def test_launch_run_tool_sets_in_progress_action(
    session, project_id: str, fake_bin: str, tmp_path: Path
) -> None:
    from orquesta_api.executors.local import LocalExecutor

    # Seed team.json so ensure_workspace_ready skips `orq-lite init`.
    workspace = Path((await session.get(ProjectRow, project_id)).workspace_path)
    workspace.mkdir(parents=True, exist_ok=True)
    (workspace / "team.json").write_text("{}")

    tools = ToolExecutor(session, ServeManager())
    # Monkeypatch RunSupervisor's default executor via direct construction inside the tool
    # is not exposed, so exercise the real path with the fake binary on PATH-equivalent:
    import orquesta_api.services.runs as runs_module

    original = runs_module.make_executor
    runs_module.make_executor = lambda: LocalExecutor(
        bin_path=fake_bin, log_dir=tmp_path / "run-logs"
    )
    try:
        result = await tools.execute(
            "launch_run", {"project_id": project_id, "kind": "run", "flow": None, "inputs": {}}
        )
    finally:
        runs_module.make_executor = original

    assert result.action == "in_progress"
    assert result.project == project_id
    assert "run_id" in result.payload

    # Drain the background supervisor task the launch spawned.
    import asyncio

    tasks = list(runs_module._SUPERVISOR_TASKS)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def test_unknown_tool_returns_error_payload_not_exception(session) -> None:
    tools = ToolExecutor(session, ServeManager())
    result = await tools.execute("delete_everything", {})
    assert "error" in result.payload


# ---------------------------------------------------------------------------
# Scoped conversations: project chat and global chat persist independently
# ---------------------------------------------------------------------------


async def test_project_and_global_conversations_are_isolated(session) -> None:
    """Messages sent to project:prm and global must not appear in each other's history."""
    model = FakeChatModel(
        [
            [TextDelta("Global reply."), Stop(stop_reason="end_turn")],
            [TextDelta("Project reply."), Stop(stop_reason="end_turn")],
        ]
    )
    tools = ToolExecutor(session, ServeManager())
    service = ChatService(session, tools, model)

    # One turn in the global conversation.
    _ = [e async for e in service.send("global question", conversation_id="global")]
    # One turn in the project-scoped conversation.
    _ = [e async for e in service.send("project question", conversation_id="project:prm")]

    global_history = await get_history(session, "global")
    project_history = await get_history(session, "project:prm")

    # Each conversation has exactly its own two messages (user + assistant).
    assert [h.role for h in global_history] == ["user", "assistant"]
    assert [h.role for h in project_history] == ["user", "assistant"]

    assert global_history[0].content == "global question"
    assert project_history[0].content == "project question"
    assert global_history[1].content == "Global reply."
    assert project_history[1].content == "Project reply."

    # Cross-contamination check: the global conversation must not contain
    # messages from the project scope and vice versa.
    global_texts = {h.content for h in global_history}
    project_texts = {h.content for h in project_history}
    assert "project question" not in global_texts
    assert "global question" not in project_texts


async def test_project_scoped_send_sets_project_field_on_first_message(session) -> None:
    """The persisted assistant message for a project-scoped send tracks the project."""
    model = FakeChatModel([[TextDelta("Done."), Stop(stop_reason="end_turn")]])
    tools = ToolExecutor(session, ServeManager())
    service = ChatService(session, tools, model)

    _ = [
        e
        async for e in service.send(
            "do something", conversation_id="project:atlas", project_id="atlas"
        )
    ]

    history = await get_history(session, "project:atlas")
    assistant_msg = next(h for h in history if h.role == "assistant")
    assert assistant_msg.project == "atlas"


# ---------------------------------------------------------------------------
# build_system_prompt: project context injection
# ---------------------------------------------------------------------------


def test_build_system_prompt_without_project_id() -> None:
    prompt = build_system_prompt()
    assert "orquesta" in prompt.lower()
    # No project context line when project_id is absent.
    assert "Active project" not in prompt


def test_build_system_prompt_with_project_id_includes_context() -> None:
    prompt = build_system_prompt("prm")
    assert "prm" in prompt
    assert "Active project" in prompt


def test_build_system_prompt_different_projects_produce_different_prompts() -> None:
    prompt_a = build_system_prompt("alpha")
    prompt_b = build_system_prompt("beta")
    assert prompt_a != prompt_b
    assert "alpha" in prompt_a
    assert "beta" in prompt_b
    assert "alpha" not in prompt_b
    assert "beta" not in prompt_a


# ---------------------------------------------------------------------------
# ChatRequest schema: project_id field is accepted and rejects extra fields
# ---------------------------------------------------------------------------


def test_chat_request_accepts_project_id() -> None:
    from orquesta_api.routers.chat import ChatRequest

    req = ChatRequest(message="hello", conversation_id="project:prm", project_id="prm")
    assert req.project_id == "prm"
    assert req.conversation_id == "project:prm"


def test_chat_request_project_id_defaults_to_none() -> None:
    from orquesta_api.routers.chat import ChatRequest

    req = ChatRequest(message="hello")
    assert req.project_id is None


def test_chat_request_rejects_extra_fields() -> None:
    from pydantic import ValidationError

    from orquesta_api.routers.chat import ChatRequest

    with pytest.raises(ValidationError):
        ChatRequest(message="hi", unknown_field="bad")

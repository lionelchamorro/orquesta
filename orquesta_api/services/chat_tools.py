"""Chat tool schemas + dispatch: each tool maps 1:1 onto an existing service call.

No tool ever touches a workspace file directly — every mutation goes through
RunSupervisor.launch() (which shells out to the orq-lite CLI) or
ProjectService, exactly like the console UI does. append_feature is the
sharpest instance of that: it does not write features.md itself, it passes
the feature text as a flow *input* so whichever orq-lite step in the
project's flows.json is responsible for it performs the actual write.
"""

from dataclasses import dataclass
from typing import Any

from orquesta_api.meta.models import ProjectWatch, RunKind
from orquesta_api.services.aggregator import Aggregator
from orquesta_api.services.projects import ProjectService
from orquesta_api.services.runs import RunSupervisor

TOOL_SCHEMAS: list[dict[str, Any]] = [
    {
        "name": "list_projects",
        "description": "List every registered project with its current state and watch flags.",
        "input_schema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_project_status",
        "description": "Get a project's live status: task/feature counts, cost, and current state.",
        "input_schema": {
            "type": "object",
            "properties": {"project_id": {"type": "string"}},
            "required": ["project_id"],
        },
    },
    {
        "name": "launch_run",
        "description": (
            "Launch a run for a project. kind is 'factory' (legacy queue) or 'flow' "
            "(named flow from the project's flows.json, e.g. pr_review/issue_fix)."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "kind": {"type": "string", "enum": ["factory", "flow", "plan", "run"]},
                "flow": {"type": "string", "description": "Flow name, required when kind=flow"},
                "inputs": {"type": "object", "description": "Flow input key/value pairs"},
            },
            "required": ["project_id", "kind"],
        },
    },
    {
        "name": "toggle_watch",
        "description": "Enable or disable the PR and/or issue watcher for a project.",
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "prs": {"type": "boolean"},
                "issues": {"type": "boolean"},
            },
            "required": ["project_id"],
        },
    },
    {
        "name": "register_project",
        "description": "Register a new project by repo URL or an existing local workspace path.",
        "input_schema": {
            "type": "object",
            "properties": {
                "name": {"type": "string"},
                "repo_url": {"type": "string"},
                "workspace_path": {"type": "string"},
                "base_branch": {"type": "string"},
                "watch": {"type": "boolean"},
            },
            "required": ["name", "base_branch"],
        },
    },
    {
        "name": "append_feature",
        "description": (
            "Queue a feature for a project by launching its 'factory' flow with the feature "
            "description as an input — the flow itself is responsible for recording it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "project_id": {"type": "string"},
                "feature_text": {"type": "string"},
            },
            "required": ["project_id", "feature_text"],
        },
    },
]


@dataclass
class ToolResult:
    """What a tool call produced: the payload fed back to the model, plus UI metadata."""

    payload: dict[str, Any]
    action: str | None = None
    project: str | None = None


class ToolExecutor:
    """Dispatches a tool_use block by name to the matching service call."""

    def __init__(self, session, serves) -> None:
        self._session = session
        self._serves = serves

    async def execute(self, name: str, tool_input: dict[str, Any]) -> ToolResult:
        handler = getattr(self, f"_tool_{name}", None)
        if handler is None:
            return ToolResult(payload={"error": f"unknown tool {name!r}"})
        try:
            return await handler(**tool_input)
        except Exception as exc:  # surfaced to the model as a tool error, not a 500
            return ToolResult(payload={"error": str(exc)})

    async def _tool_list_projects(self) -> ToolResult:
        rows = await ProjectService(self._session).list()
        projects = [
            {
                "id": r.id,
                "name": r.name,
                "state": r.state,
                "watch_prs": r.watch_prs,
                "watch_issues": r.watch_issues,
            }
            for r in rows
        ]
        return ToolResult(payload={"projects": projects})

    async def _tool_get_project_status(self, project_id: str) -> ToolResult:
        row = await ProjectService(self._session).get(project_id)
        snapshot = await Aggregator(serves=self._serves).snapshot(project_id)
        return ToolResult(
            payload={
                "id": row.id,
                "name": row.name,
                "state": row.state,
                "tasks_done": sum(1 for t in snapshot.tasks if t.status == "done"),
                "tasks_total": len(snapshot.tasks),
                "features_total": len(snapshot.features),
                "cost_usd": snapshot.cost.total_usd,
            },
            project=project_id,
        )

    async def _tool_launch_run(
        self,
        project_id: str,
        kind: str,
        flow: str | None = None,
        inputs: dict[str, str] | None = None,
    ) -> ToolResult:
        run = await RunSupervisor(self._session).launch(
            project_id, kind=RunKind(kind), flow=flow, inputs=inputs or {}
        )
        return ToolResult(
            payload={"run_id": run.id, "state": run.state},
            action="in_progress",
            project=project_id,
        )

    async def _tool_toggle_watch(
        self, project_id: str, prs: bool | None = None, issues: bool | None = None
    ) -> ToolResult:
        row = await ProjectService(self._session).get(project_id)
        watch = ProjectWatch(
            prs=prs if prs is not None else row.watch_prs,
            issues=issues if issues is not None else row.watch_issues,
        )
        updated = await ProjectService(self._session).update(project_id, watch=watch.model_dump())
        return ToolResult(
            payload={"watch_prs": updated.watch_prs, "watch_issues": updated.watch_issues},
            action="done",
            project=project_id,
        )

    async def _tool_register_project(
        self,
        name: str,
        base_branch: str,
        repo_url: str | None = None,
        workspace_path: str | None = None,
        watch: bool = False,
    ) -> ToolResult:
        row = await ProjectService(self._session, serves=self._serves).create(
            name=name,
            repo_url=repo_url,
            workspace_path=workspace_path,
            base_branch=base_branch,
            watch=watch,
        )
        return ToolResult(payload={"id": row.id, "state": row.state}, action="done", project=row.id)

    async def _tool_append_feature(self, project_id: str, feature_text: str) -> ToolResult:
        run = await RunSupervisor(self._session).launch(
            project_id, kind=RunKind.flow, flow="factory", inputs={"feature": feature_text}
        )
        return ToolResult(
            payload={"run_id": run.id, "state": run.state},
            action="in_progress",
            project=project_id,
        )

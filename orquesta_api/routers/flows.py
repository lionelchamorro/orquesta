"""Per-project flow configuration endpoints backed by flows.json.

Routes are nested under ``/projects/{project_id}`` so that each project's
flows.json is read from and written to its own workspace directory.

The POST/PUT body is a :class:`FlowDefinition` (typed model).  The router
converts it to the raw flow-entry dict via ``model_dump`` before passing it to
the store's ``upsert`` method, which deep-merges the patch onto any existing
entry so that unknown fields in that entry survive the round-trip.
"""

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.meta.models import FlowDefinition, validate_flow_steps
from orquesta_api.services.config_files import FlowConfigStore
from orquesta_api.services.projects import ProjectService

router = APIRouter(prefix="/projects", tags=["flows"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


# ast-grep-ignore: no-dict-return-annotation
def _to_raw_patch(
    body: FlowDefinition,
) -> dict[str, Any]:
    """Convert a FlowDefinition to the raw flow-entry dict for merging.

    Only the engine's own Flow keys ({description, inputs, steps}) are ever
    written — flows.json is a user-owned file that `orq-lite flow run`
    parses, and the acceptance criterion is that editing one field changes
    only that field in the diff. UI-side conveniences (id/name/entrypoint/
    source) never reach disk. ``by_alias=True`` writes the ``as`` key (not
    the Python-safe ``as_`` field name) for loop steps.
    """
    patch = body.model_dump(
        include={"description", "inputs", "steps"}, exclude_none=True, by_alias=True
    )
    if not patch.get("inputs"):
        # Don't stamp an empty "inputs": {} into flows that never declared any.
        patch.pop("inputs", None)
    return patch


def _validate_or_422(body: FlowDefinition) -> None:
    errors = validate_flow_steps(body.steps)
    if errors:
        raise HTTPException(status_code=422, detail=errors)


async def _get_workspace(project_id: str, session: AsyncSession) -> Path:
    """Resolve the workspace path for a project; raises ValueError if absent."""
    row = await ProjectService(session).get(project_id)
    if not row.workspace_path:
        raise ValueError(f"Project '{project_id}' has no workspace_path configured")
    return Path(row.workspace_path)


@router.get("/{project_id}/flows")
async def list_flows(project_id: str, session: SessionDep) -> list[FlowDefinition]:
    """Return all flows defined in the project's flows.json."""
    workspace = await _get_workspace(project_id, session)
    return FlowConfigStore(workspace).list()


@router.post("/{project_id}/flows", status_code=201)
async def create_flow(project_id: str, body: FlowDefinition, session: SessionDep) -> FlowDefinition:
    """Create or replace a flow entry in the project's flows.json."""
    _validate_or_422(body)
    workspace = await _get_workspace(project_id, session)
    patch = _to_raw_patch(body)
    return FlowConfigStore(workspace).upsert(body.id, patch)


@router.put("/{project_id}/flows/{flow_id}")
async def update_flow(
    project_id: str, flow_id: str, body: FlowDefinition, session: SessionDep
) -> FlowDefinition:
    """Merge the request body onto the named flow entry in flows.json."""
    _validate_or_422(body)
    workspace = await _get_workspace(project_id, session)
    patch = _to_raw_patch(body)
    return FlowConfigStore(workspace).upsert(flow_id, patch)


@router.delete("/{project_id}/flows/{flow_id}", status_code=204)
async def delete_flow(project_id: str, flow_id: str, session: SessionDep) -> None:
    """Remove a flow entry from the project's flows.json."""
    workspace = await _get_workspace(project_id, session)
    FlowConfigStore(workspace).delete(flow_id)

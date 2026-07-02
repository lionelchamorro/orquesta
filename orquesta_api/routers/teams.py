"""Per-project team configuration endpoints backed by team.json.

Routes are nested under ``/projects/{project_id}`` so that each project's
team.json is read from and written to its own workspace directory — matching
exactly how ``orq-lite`` resolves the file at runtime.

The PUT body is a :class:`TeamDefinition` (full typed model) for FastAPI
validation and OpenAPI schema.  The router converts it to the raw dict format
that ``team.json`` uses (agents / roles as dicts keyed by name) before passing
it to the store's ``update(patch=...)`` method.  This way the store's
deep-merge layer preserves any fields the model does not know about (e.g.
``rate_limit_backoff``, ``limits.preflight_enabled``).
"""

from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.session import get_session
from orquesta_api.meta.models import TeamDefinition
from orquesta_api.services.config_files import TeamConfigStore
from orquesta_api.services.projects import ProjectService

router = APIRouter(prefix="/projects", tags=["teams"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _to_raw_patch(body: TeamDefinition) -> dict[str, Any]:
    """Convert a typed TeamDefinition into the raw team.json patch dict.

    The raw format stores agents and roles as dicts keyed by name, whereas the
    Pydantic model uses lists.  Only fields included here will be merged onto
    the existing file; all other existing fields (rate_limit_backoff, etc.) are
    preserved by the deep-merge step in the store.
    """
    patch: dict[str, Any] = {
        "agents": {
            agent.id: agent.model_dump(exclude={"id"}, exclude_none=True) for agent in body.agents
        },
        "roles": {
            role.role: role.model_dump(exclude={"role"}, exclude_none=True) for role in body.roles
        },
        "limits": body.limits.model_dump(exclude_none=True),
        "full_test_command": body.full_test_command,
        "lint_command": body.lint_command or "",
    }
    # Only include name / description if they differ from defaults so that a
    # freshly-scaffolded team.json (which has neither) is not polluted.
    if body.name:
        patch["name"] = body.name
    if body.description:
        patch["description"] = body.description
    if body.conventions_file is not None:
        patch["conventions_file"] = body.conventions_file
    return patch


async def _get_workspace(project_id: str, session: AsyncSession) -> Path:
    """Resolve the workspace path for a project; raises ValueError if absent."""
    row = await ProjectService(session).get(project_id)
    if not row.workspace_path:
        raise ValueError(f"Project '{project_id}' has no workspace_path configured")
    return Path(row.workspace_path)


@router.get("/{project_id}/team")
async def get_team(project_id: str, session: SessionDep) -> TeamDefinition:
    """Return the team.json config for a project."""
    workspace = await _get_workspace(project_id, session)
    return TeamConfigStore(workspace).get("default")


@router.put("/{project_id}/team")
async def update_team(project_id: str, body: TeamDefinition, session: SessionDep) -> TeamDefinition:
    """Merge the request body onto the project's team.json and return the result.

    Unknown fields already present in team.json (e.g. ``rate_limit_backoff``)
    are preserved; only the fields known to ``TeamDefinition`` are patched.
    """
    workspace = await _get_workspace(project_id, session)
    patch = _to_raw_patch(body)
    return TeamConfigStore(workspace).update(patch)

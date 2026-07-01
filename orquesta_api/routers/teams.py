"""Team configuration endpoints backed by team.json."""

from fastapi import APIRouter

from orquesta_api.meta.models import TeamDefinition
from orquesta_api.services.config_files import TeamConfigStore

router = APIRouter(prefix="/teams", tags=["teams"])


@router.get("")
async def list_teams() -> list[TeamDefinition]:
    return TeamConfigStore().list()


@router.get("/{team_id}")
async def get_team(team_id: str) -> TeamDefinition:
    return TeamConfigStore().get(team_id)


@router.put("/{team_id}")
async def update_team(team_id: str, body: TeamDefinition) -> TeamDefinition:
    return TeamConfigStore().update(team_id, body)

"""Skill catalog endpoints."""

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict

from orquesta_api.services.skills import load_skill_catalog

router = APIRouter(tags=["skills"])


class SkillSummary(BaseModel):
    """Skill metadata and body exposed by GET /skills."""

    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    description: str
    suggested_roles: list[str]
    body: str


class SkillsResponse(BaseModel):
    """Response body for GET /skills."""

    model_config = ConfigDict(extra="forbid")

    skills: list[SkillSummary]


@router.get("/skills")
async def list_skills() -> SkillsResponse:
    """Return the in-repo skill catalog."""
    return SkillsResponse(
        skills=[
            SkillSummary(
                id=skill.id,
                name=skill.name,
                description=skill.description,
                suggested_roles=skill.suggested_roles,
                body=skill.body,
            )
            for skill in load_skill_catalog()
        ]
    )

"""Team configuration update service."""

from pathlib import Path
from typing import Any

from orquesta_api.meta.models import TeamDefinition
from orquesta_api.services.config_files import TeamConfigStore
from orquesta_api.services.skills import (
    SkillDefinition,
    compose_role_prompt_file_async,
    selected_skills,
)


class UnknownSkillsError(ValueError):
    """Raised when a team references skill ids absent from the catalog."""

    def __init__(self, unknown_skill_ids: list[str]) -> None:
        self.unknown_skill_ids = sorted(set(unknown_skill_ids))
        super().__init__(f"Unknown skill ids: {', '.join(self.unknown_skill_ids)}")


class TeamService:
    """Business operations for a project's team.json configuration."""

    async def update_with_skills(
        self,
        workspace: Path,
        body: TeamDefinition,
        catalog: list[SkillDefinition],
    ) -> TeamDefinition:
        """Merge a team update, validate selected skills, and rewrite prompts."""
        store = TeamConfigStore(workspace)
        patch = self._to_raw_patch(body)
        merged = store.preview_update(patch)
        self._validate_skill_ids(merged, catalog)
        updated = store.update(patch)
        for role in updated.roles:
            await compose_role_prompt_file_async(workspace, role.prompt, role.skills or [], catalog)
        return updated

    def _validate_skill_ids(self, body: TeamDefinition, catalog: list[SkillDefinition]) -> None:
        unknown_skill_ids: list[str] = []
        known_ids = {skill.id for skill in catalog}
        for role in body.roles:
            role_skills = role.skills or []
            try:
                selected_skills(catalog, role_skills)
            except ValueError:
                unknown_skill_ids.extend(
                    skill_id for skill_id in role_skills if skill_id not in known_ids
                )
        if unknown_skill_ids:
            raise UnknownSkillsError(unknown_skill_ids)

    # ast-grep-ignore: no-dict-return-annotation
    def _to_raw_patch(self, body: TeamDefinition) -> dict[str, Any]:
        """Convert a typed TeamDefinition into the raw team.json patch dict."""
        patch: dict[str, Any] = {
            "agents": {
                agent.id: agent.model_dump(exclude={"id"}, exclude_none=True)
                for agent in body.agents
            },
            "roles": {
                role.role: role.model_dump(exclude={"role"}, exclude_none=True)
                for role in body.roles
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

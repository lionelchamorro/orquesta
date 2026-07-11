"""Skill catalog parsing and prompt-block composition."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from orquesta_api.logger import get_logger

logger = get_logger(__name__)

START_MARKER = "<!-- orquesta:skills start -->"
END_MARKER = "<!-- orquesta:skills end -->"
_HEADER_FIELDS = ("id", "name", "description", "suggested_roles")
_SKILLS_DIR = Path(__file__).resolve().parents[1] / "skills"


@dataclass(frozen=True)
class SkillDefinition:
    """Parsed skill metadata and instruction body."""

    id: str
    name: str
    description: str
    suggested_roles: list[str]
    body: str


def _parse_header_line(line: str, expected_key: str, path: Path) -> str:
    prefix = f"{expected_key}:"
    if not line.startswith(prefix):
        msg = f"{path} header line must start with {prefix!r}"
        raise ValueError(msg)
    return line[len(prefix) :].strip()


def parse_skill_file(path: Path) -> SkillDefinition:
    """Parse one markdown skill file."""
    lines = path.read_text().splitlines()
    if len(lines) < len(_HEADER_FIELDS) + 1:
        msg = f"{path} is missing required skill header"
        raise ValueError(msg)

    values = {
        key: _parse_header_line(lines[index], key, path) for index, key in enumerate(_HEADER_FIELDS)
    }
    body_start = len(_HEADER_FIELDS)
    if body_start < len(lines) and lines[body_start] == "":
        body_start += 1
    body = "\n".join(lines[body_start:]).strip()
    if not body:
        msg = f"{path} has an empty skill body"
        raise ValueError(msg)

    return SkillDefinition(
        id=values["id"],
        name=values["name"],
        description=values["description"],
        suggested_roles=[
            role.strip() for role in values["suggested_roles"].split(",") if role.strip()
        ],
        body=body,
    )


def load_skill_catalog(skills_dir: Path | None = None) -> list[SkillDefinition]:
    """Load all markdown skills in deterministic id order."""
    root = skills_dir or _SKILLS_DIR
    skills = [parse_skill_file(path) for path in sorted(root.glob("*.md"))]
    ordered = sorted(skills, key=lambda skill: skill.id)
    logger.debug("skill_catalog_loaded => count=%s skills_dir=%s", len(ordered), root)
    return ordered


def selected_skills(
    catalog: Sequence[SkillDefinition], skill_ids: Sequence[str]
) -> list[SkillDefinition]:
    """Return selected skills in *skill_ids* order; raise ValueError for unknown ids."""
    by_id = {skill.id: skill for skill in catalog}
    unknown = [skill_id for skill_id in skill_ids if skill_id not in by_id]
    if unknown:
        msg = f"Unknown skill ids: {', '.join(unknown)}"
        raise ValueError(msg)
    return [by_id[skill_id] for skill_id in skill_ids]


def compose_skill_block(skills: Sequence[SkillDefinition]) -> str:
    """Return the managed prompt block for *skills*."""
    bodies = "\n\n".join(skill.body.rstrip() for skill in skills)
    return f"{START_MARKER}\n{bodies}\n{END_MARKER}"


def rewrite_prompt_skill_block(content: str, skills: Sequence[SkillDefinition]) -> str:
    """Replace, append, or remove the managed skill block in *content*."""
    start = content.find(START_MARKER)
    end = content.find(END_MARKER, start + len(START_MARKER)) if start != -1 else -1
    replacement = compose_skill_block(skills) if skills else ""

    if start != -1 and end != -1:
        return content[:start] + replacement + content[end + len(END_MARKER) :]

    if not skills:
        return content

    separator = "" if not content or content.endswith("\n") else "\n"
    return f"{content}{separator}{replacement}"


def compose_role_prompt_file(
    workspace: Path,
    prompt: str,
    skill_ids: Sequence[str],
    catalog: Sequence[SkillDefinition],
) -> None:
    """Rewrite one role prompt file with the managed skill block."""
    workspace_root = workspace.resolve()
    prompt_path = (workspace_root / prompt).resolve()
    if not prompt_path.is_relative_to(workspace_root):
        msg = f"Prompt path must stay inside workspace: {prompt}"
        raise ValueError(msg)
    content = prompt_path.read_text() if prompt_path.exists() else ""
    skills = selected_skills(catalog, skill_ids)
    rewritten = rewrite_prompt_skill_block(content, skills)
    if rewritten == content:
        return
    prompt_path.parent.mkdir(parents=True, exist_ok=True)
    prompt_path.write_text(rewritten)

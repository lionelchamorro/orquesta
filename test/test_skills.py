import json
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from starlette.requests import Request
from starlette.testclient import TestClient

from orquesta_api.db.session import get_session
from orquesta_api.db.tables import ProjectRow
from orquesta_api.routers.skills import router as skills_router
from orquesta_api.routers.teams import router as teams_router
from orquesta_api.services.config_files import TeamConfigStore
from orquesta_api.services.skills import (
    END_MARKER,
    START_MARKER,
    compose_skill_block,
    load_skill_catalog,
    rewrite_prompt_skill_block,
)


def test_shipped_skill_catalog_parses_deterministically() -> None:
    catalog = load_skill_catalog()

    assert [skill.id for skill in catalog] == [
        "code-review-checklist",
        "repo-conventions",
        "tdd-workflow",
        "verification-evidence",
    ]
    assert [
        (skill.id, skill.name, skill.description, skill.suggested_roles) for skill in catalog
    ] == [
        (
            "code-review-checklist",
            "Code Review Checklist",
            "Concrete review checklist for critic and reviewer roles.",
            ["critic", "reviewer"],
        ),
        (
            "repo-conventions",
            "Repo Conventions",
            "Read and honor repo instructions and lint configuration before writing code.",
            ["all"],
        ),
        (
            "tdd-workflow",
            "TDD Workflow",
            "Write a failing test first, implement the minimum to pass, then refactor.",
            ["coder"],
        ),
        (
            "verification-evidence",
            "Verification Evidence",
            "Require concrete command output before claiming a pass.",
            ["tester", "verifier"],
        ),
    ]
    assert "hidden assumptions" in catalog[0].body
    assert "never weaken an assertion" in next(s for s in catalog if s.id == "tdd-workflow").body


def _make_skills_app() -> FastAPI:
    app = FastAPI()
    app.include_router(skills_router)
    return app


def test_get_skills_returns_header_fields_only() -> None:
    client = TestClient(_make_skills_app())

    res = client.get("/skills")

    assert res.status_code == 200
    assert res.json() == {
        "skills": [
            {
                "id": "code-review-checklist",
                "name": "Code Review Checklist",
                "description": "Concrete review checklist for critic and reviewer roles.",
                "suggested_roles": ["critic", "reviewer"],
            },
            {
                "id": "repo-conventions",
                "name": "Repo Conventions",
                "description": (
                    "Read and honor repo instructions and lint configuration before writing code."
                ),
                "suggested_roles": ["all"],
            },
            {
                "id": "tdd-workflow",
                "name": "TDD Workflow",
                "description": (
                    "Write a failing test first, implement the minimum to pass, then refactor."
                ),
                "suggested_roles": ["coder"],
            },
            {
                "id": "verification-evidence",
                "name": "Verification Evidence",
                "description": "Require concrete command output before claiming a pass.",
                "suggested_roles": ["tester", "verifier"],
            },
        ]
    }
    assert "body" not in res.text


def test_team_config_skills_round_trip_losslessly(tmp_path: Path) -> None:
    team_file = tmp_path / "team.json"
    initial = {
        "agents": {"codex": {"provider": "codex", "model": "gpt-5.5"}},
        "roles": {
            "coder": {
                "agents": ["codex"],
                "prompt": "prompts/coder.md",
                "result_path": ".orquestalite/results/coder.json",
                "timeout_seconds": 600,
                "skills": ["tdd-workflow", "repo-conventions"],
            }
        },
    }
    team_file.write_text(json.dumps(initial, indent=2))

    store = TeamConfigStore(tmp_path)
    team = store.get("default")
    assert team.roles[0].skills == ["tdd-workflow", "repo-conventions"]

    store.update(
        {
            "roles": {
                "coder": team.roles[0].model_dump(exclude={"role"}, exclude_none=True),
            }
        }
    )

    reread = json.loads(team_file.read_text())
    assert reread["roles"]["coder"]["skills"] == ["tdd-workflow", "repo-conventions"]


def test_prompt_skill_block_rewrite_is_idempotent_and_preserves_base() -> None:
    catalog = load_skill_catalog()
    selected = [skill for skill in catalog if skill.id in ("tdd-workflow", "verification-evidence")]
    base = "# Coder\n\nKeep this exact text.\n"

    once = rewrite_prompt_skill_block(base, selected)
    twice = rewrite_prompt_skill_block(once, selected)

    assert once == twice
    assert once.startswith(base)
    assert START_MARKER in once
    assert END_MARKER in once
    assert once.index("write a failing test first") < once.index("Any claim of")


def test_prompt_skill_block_removal_preserves_surrounding_text() -> None:
    catalog = load_skill_catalog()
    block = compose_skill_block([next(skill for skill in catalog if skill.id == "tdd-workflow")])
    existing = f"alpha\n{block}\nomega\n"

    assert rewrite_prompt_skill_block(existing, []) == "alpha\n\nomega\n"


async def test_update_team_composes_role_prompt_and_rejects_unknown_skill(
    session, tmp_path: Path
) -> None:
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "team.json").write_text(
        json.dumps(
            {
                "agents": {"codex": {"provider": "codex", "model": "gpt-5.5"}},
                "roles": {
                    "coder": {
                        "agents": ["codex"],
                        "prompt": "prompts/coder.md",
                        "result_path": ".orquestalite/results/coder.json",
                        "timeout_seconds": 600,
                    }
                },
            }
        )
    )
    prompt_path = workspace / "prompts" / "coder.md"
    prompt_path.parent.mkdir()
    prompt_path.write_text("base prompt\n")
    session.add(
        ProjectRow(
            id="proj",
            name="Project",
            workspace_path=str(workspace),
            base_branch="main",
        )
    )
    await session.commit()

    app = FastAPI()
    app.include_router(teams_router)

    @app.exception_handler(ValueError)
    async def _value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    async def override_get_session():
        yield session

    app.dependency_overrides[get_session] = override_get_session
    client = TestClient(app)

    body = {
        "id": "default",
        "name": "Default delivery team",
        "description": "orq-lite team.json roster",
        "agents": [{"id": "codex", "provider": "codex", "model": "gpt-5.5"}],
        "roles": [
            {
                "role": "coder",
                "agents": ["codex"],
                "prompt": "prompts/coder.md",
                "result_path": ".orquestalite/results/coder.json",
                "timeout_seconds": 600,
                "skills": ["tdd-workflow"],
            }
        ],
        "limits": {},
        "full_test_command": "",
        "lint_command": "",
    }

    res = client.put("/projects/proj/team", json=body)
    assert res.status_code == 200
    composed = prompt_path.read_text()
    assert composed.startswith("base prompt\n")
    assert "write a failing test first" in composed

    res = client.put("/projects/proj/team", json=body)
    assert res.status_code == 200
    assert prompt_path.read_text() == composed

    del body["roles"][0]["skills"]
    res = client.put("/projects/proj/team", json=body)
    assert res.status_code == 200
    assert json.loads((workspace / "team.json").read_text())["roles"]["coder"]["skills"] == [
        "tdd-workflow"
    ]
    assert prompt_path.read_text() == composed

    body["roles"][0]["skills"] = []
    res = client.put("/projects/proj/team", json=body)
    assert res.status_code == 200
    assert prompt_path.read_text() == "base prompt\n"

    body["roles"][0]["skills"] = ["missing-skill"]
    res = client.put("/projects/proj/team", json=body)
    assert res.status_code == 422
    assert "missing-skill" in str(res.json()["detail"])

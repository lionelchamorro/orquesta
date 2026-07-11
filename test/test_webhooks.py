"""Task 13: GitHub webhook signature verification + PR/issue -> flow launch mapping."""

import hashlib
import hmac
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from orquesta_api.core.integrations.github import verify_signature
from orquesta_api.db.session import get_session
from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.routers.webhooks import router as webhooks_router
from orquesta_api.services.watchers import WatcherService, _normalize_repo_url

# ---------------------------------------------------------------------------
# verify_signature
# ---------------------------------------------------------------------------


def test_verify_signature_accepts_a_correct_hmac() -> None:
    body = b'{"action": "opened"}'
    secret = "shh"  # noqa: S105 — test fixture value, not a real credential
    signature = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert verify_signature(secret, body, signature) is True


def test_verify_signature_rejects_a_wrong_hmac() -> None:
    body = b'{"action": "opened"}'
    assert verify_signature("shh", body, "sha256=deadbeef") is False


def test_verify_signature_rejects_a_missing_header() -> None:
    assert verify_signature("shh", b"{}", None) is False


def test_verify_signature_is_a_noop_when_secret_is_empty() -> None:
    assert verify_signature("", b"{}", None) is True


# ---------------------------------------------------------------------------
# _normalize_repo_url
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/acme/atlas",
        "https://github.com/acme/atlas.git",
        "https://github.com/acme/atlas/",
        "git@github.com:acme/atlas.git",
        "HTTPS://GITHUB.COM/acme/ATLAS",
    ],
)
def test_normalize_repo_url_variants_match(url: str) -> None:
    assert _normalize_repo_url(url) == "github.com/acme/atlas"


# ---------------------------------------------------------------------------
# WatcherService
# ---------------------------------------------------------------------------


@pytest.fixture
async def watched_project(session, tmp_path: Path) -> str:
    row = ProjectRow(
        id="atlas",
        name="Atlas",
        repo_url="https://github.com/acme/atlas",
        workspace_path=str(tmp_path / "atlas"),
        watch_prs=True,
        watch_issues=False,
    )
    (tmp_path / "atlas").mkdir()
    (tmp_path / "atlas" / "team.json").write_text("{}")
    session.add(row)
    await session.commit()
    return "atlas"


# ast-grep-ignore: no-dict-return-annotation
def _pr_payload(action: str, number: int = 42) -> dict:
    # ast-grep-ignore: no-dict-literal-return
    return {
        "action": action,
        "number": number,
        "pull_request": {"number": number},
        "repository": {"clone_url": "https://github.com/acme/atlas.git"},
    }


# ast-grep-ignore: no-dict-return-annotation
def _issue_payload(action: str, number: int = 7) -> dict:
    # ast-grep-ignore: no-dict-literal-return
    return {
        "action": action,
        "issue": {"number": number},
        "repository": {"clone_url": "https://github.com/acme/atlas.git"},
    }


async def test_pr_opened_on_watched_project_launches_pr_review(
    session, watched_project: str, monkeypatch, fake_bin: str, tmp_path: Path
) -> None:
    import orquesta_api.services.runs as runs_module
    from orquesta_api.executors.local import LocalExecutor

    monkeypatch.setattr(
        runs_module,
        "make_executor",
        lambda: LocalExecutor(bin_path=fake_bin, log_dir=tmp_path / "run-logs"),
    )

    watchers = WatcherService(session)
    run = await watchers.handle_pull_request(_pr_payload("opened"))
    assert run is not None
    assert run.project_id == watched_project


async def test_pr_event_ignored_when_watch_prs_disabled(session, tmp_path: Path) -> None:
    row = ProjectRow(
        id="orion",
        name="Orion",
        repo_url="https://github.com/acme/orion",
        workspace_path=str(tmp_path / "orion"),
        watch_prs=False,
    )
    session.add(row)
    await session.commit()

    watchers = WatcherService(session)
    payload = _pr_payload("opened")
    payload["repository"]["clone_url"] = "https://github.com/acme/orion.git"
    run = await watchers.handle_pull_request(payload)
    assert run is None


async def test_pr_event_ignored_for_unmatched_repo(session) -> None:
    watchers = WatcherService(session)
    payload = _pr_payload("opened")
    payload["repository"]["clone_url"] = "https://github.com/someone-else/unknown.git"
    assert await watchers.handle_pull_request(payload) is None


async def test_pr_event_ignored_for_unhandled_action(session, watched_project: str) -> None:
    watchers = WatcherService(session)
    assert await watchers.handle_pull_request(_pr_payload("closed")) is None


async def test_issue_opened_ignored_when_watch_issues_disabled(
    session, watched_project: str
) -> None:
    watchers = WatcherService(session)
    assert await watchers.handle_issues(_issue_payload("opened")) is None


async def test_duplicate_delivery_is_detected(session) -> None:
    watchers = WatcherService(session)
    assert await watchers.is_duplicate_delivery("delivery-1") is False
    assert await watchers.is_duplicate_delivery("delivery-1") is True


# ---------------------------------------------------------------------------
# Router: signature enforcement + dedupe + end-to-end launch
# ---------------------------------------------------------------------------


def _make_app(session) -> FastAPI:
    from fastapi.responses import JSONResponse
    from starlette.requests import Request

    app = FastAPI()
    app.include_router(webhooks_router)

    @app.exception_handler(PermissionError)
    async def _permission_error_handler(_request: Request, exc: PermissionError) -> JSONResponse:
        return JSONResponse(status_code=401, content={"detail": str(exc)})

    async def override_get_session():
        yield session

    app.dependency_overrides[get_session] = override_get_session
    return app


def test_router_rejects_invalid_signature(session, monkeypatch) -> None:
    from orquesta_api.config import settings

    monkeypatch.setattr(settings, "github_webhook_secret", "shh")
    client = TestClient(_make_app(session))
    res = client.post(
        "/webhooks/github",
        content=b"{}",
        headers={
            "x-hub-signature-256": "sha256=wrong",
            "x-github-event": "ping",
            "x-github-delivery": "d1",
        },
    )
    assert res.status_code == 401


def test_router_accepts_unhandled_event_type(session) -> None:
    client = TestClient(_make_app(session))
    res = client.post(
        "/webhooks/github",
        content=b"{}",
        headers={"x-github-event": "ping", "x-github-delivery": "d2"},
    )
    assert res.status_code == 204


async def test_router_launches_a_run_for_a_real_pr_webhook(
    session, watched_project: str, monkeypatch, fake_bin: str, tmp_path: Path
) -> None:
    import orquesta_api.services.runs as runs_module
    from orquesta_api.executors.local import LocalExecutor

    monkeypatch.setattr(
        runs_module,
        "make_executor",
        lambda: LocalExecutor(bin_path=fake_bin, log_dir=tmp_path / "run-logs"),
    )

    body = json.dumps(_pr_payload("opened")).encode()
    client = TestClient(_make_app(session))
    res = client.post(
        "/webhooks/github",
        content=body,
        headers={"x-github-event": "pull_request", "x-github-delivery": "d3"},
    )
    assert res.status_code == 204

    result = await session.execute(RunRow.__table__.select())
    rows = result.fetchall()
    assert len(rows) == 1

    # Same delivery id retried by GitHub must not launch a second run.
    res2 = client.post(
        "/webhooks/github",
        content=body,
        headers={"x-github-event": "pull_request", "x-github-delivery": "d3"},
    )
    assert res2.status_code == 204
    result2 = await session.execute(RunRow.__table__.select())
    assert len(result2.fetchall()) == 1

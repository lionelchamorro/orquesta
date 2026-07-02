"""Task 12: bearer auth end-to-end.

startup_check() must fail fast when ENV=production would otherwise run
with auth silently disabled; bearer_auth_middleware must gate every route
except /health once a token is configured.
"""

import pytest
from pydantic import SecretStr
from starlette.applications import Starlette
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient

from orquesta_api.config import settings
from orquesta_api.core.auth import bearer_auth_middleware, startup_check


def _make_test_app() -> Starlette:
    async def health(_request):
        return PlainTextResponse("ok")

    async def protected(_request):
        return PlainTextResponse("secret")

    app = Starlette(routes=[Route("/health", health), Route("/protected", protected)])
    app.add_middleware(BaseHTTPMiddleware, dispatch=bearer_auth_middleware)
    return app


# ---------------------------------------------------------------------------
# startup_check
# ---------------------------------------------------------------------------


def test_startup_check_raises_in_production_without_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "auth_token", SecretStr(""))
    with pytest.raises(RuntimeError, match="ENV=production"):
        startup_check()


def test_startup_check_passes_in_production_with_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "env", "production")
    monkeypatch.setattr(settings, "auth_token", SecretStr("secret-token"))
    startup_check()  # must not raise


def test_startup_check_passes_in_development_without_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "env", "development")
    monkeypatch.setattr(settings, "auth_token", SecretStr(""))
    startup_check()  # must not raise — dev default is auth-disabled


# ---------------------------------------------------------------------------
# bearer_auth_middleware
# ---------------------------------------------------------------------------


def test_middleware_allows_all_when_token_empty(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_token", SecretStr(""))
    client = TestClient(_make_test_app())
    assert client.get("/protected").status_code == 200


def test_middleware_rejects_missing_authorization_header(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_token", SecretStr("secret-token"))
    client = TestClient(_make_test_app())
    assert client.get("/protected").status_code == 401


def test_middleware_rejects_wrong_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_token", SecretStr("secret-token"))
    client = TestClient(_make_test_app())
    res = client.get("/protected", headers={"Authorization": "Bearer wrong-token"})
    assert res.status_code == 401


def test_middleware_accepts_correct_token(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_token", SecretStr("secret-token"))
    client = TestClient(_make_test_app())
    res = client.get("/protected", headers={"Authorization": "Bearer secret-token"})
    assert res.status_code == 200
    assert res.text == "secret"


def test_health_is_exempt_even_with_token_configured(monkeypatch) -> None:
    monkeypatch.setattr(settings, "auth_token", SecretStr("secret-token"))
    client = TestClient(_make_test_app())
    assert client.get("/health").status_code == 200

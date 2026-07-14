"""MCP bridge authentication against the control-plane API."""

import httpx
import pytest
from pydantic import SecretStr

from orquesta_api.config import get_settings
from orquesta_api.mcp.server import _request


@pytest.mark.asyncio
async def test_mcp_request_sends_bearer_token_when_configured(monkeypatch) -> None:
    seen_headers: list[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(get_settings(), "auth_token", SecretStr("secret-token"))

    await _request("GET", "/projects", transport=httpx.MockTransport(handler))

    assert seen_headers[0]["authorization"] == "Bearer secret-token"


@pytest.mark.asyncio
async def test_mcp_request_omits_authorization_when_token_empty(monkeypatch) -> None:
    seen_headers: list[httpx.Headers] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_headers.append(request.headers)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(get_settings(), "auth_token", SecretStr(""))

    await _request("GET", "/projects", transport=httpx.MockTransport(handler))

    assert "authorization" not in seen_headers[0]


@pytest.mark.parametrize("status_code", [401, 403])
@pytest.mark.asyncio
async def test_mcp_request_auth_failure_mentions_auth_token(monkeypatch, status_code: int) -> None:
    def handler(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, json={"detail": "unauthorized"})

    monkeypatch.setattr(get_settings(), "auth_token", SecretStr("wrong-token"))

    with pytest.raises(RuntimeError, match="AUTH_TOKEN"):
        await _request("GET", "/projects", transport=httpx.MockTransport(handler))

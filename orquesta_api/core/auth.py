"""Bearer-token authentication for the control-plane API."""

from collections.abc import Awaitable, Callable

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from orquesta_api.config import settings

# /health must stay reachable without a token: it's what load balancers and
# container orchestrators poll to decide whether to route traffic here at all.
EXEMPT_PATHS = frozenset({"/health"})


def startup_check() -> None:
    """Fail app startup outright if ENV=production would otherwise run with auth silently off.

    Raises:
        RuntimeError: if env == "production" and auth_token is empty. An empty
            token does not raise in dev/test — it means "auth disabled",
            which is the correct default for local iteration but must never
            reach production by accident.
    """
    if settings.env == "production" and not settings.auth_token.get_secret_value():
        raise RuntimeError(
            "auth_token must be set when ENV=production (refusing to start "
            "with authentication silently disabled)"
        )


async def bearer_auth_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Require `Authorization: Bearer <settings.auth_token>` on every non-exempt route.

    When auth_token is empty (the local-dev default), auth is a no-op — every
    request passes. This is intentionally permissive for dev/test; startup_check()
    is what prevents that default from reaching production.
    """
    if request.url.path in EXEMPT_PATHS:
        return await call_next(request)

    expected = settings.auth_token.get_secret_value()
    if not expected:
        return await call_next(request)

    if request.headers.get("authorization") != f"Bearer {expected}":
        return JSONResponse(status_code=401, content={"detail": "unauthorized"})

    return await call_next(request)

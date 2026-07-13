"""GitHub webhook endpoint: PR/issue events -> flow launches for watched projects."""

import json
from typing import Annotated

from fastapi import APIRouter, Depends, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.config import settings
from orquesta_api.core.integrations.github import verify_signature
from orquesta_api.db.session import get_session
from orquesta_api.logger import get_logger
from orquesta_api.services.watchers import WatcherService

logger = get_logger(__name__)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

_HANDLED_EVENTS = {"pull_request", "issues"}


@router.post("/github", status_code=204)
async def github_webhook(request: Request, session: SessionDep) -> Response:
    """Verify, dedupe, and dispatch a GitHub webhook delivery.

    Always returns 204 for anything that isn't a signature failure — GitHub
    expects a fast 2xx ack; unmatched events, unwatched projects, and races
    with an already-active run are all legitimate "nothing to do" outcomes,
    not errors.
    """
    body = await request.body()
    signature = request.headers.get("x-hub-signature-256")
    if not verify_signature(settings.github_webhook_secret, body, signature):
        raise PermissionError("invalid webhook signature")

    delivery_id = request.headers.get("x-github-delivery")
    event = request.headers.get("x-github-event")
    if not delivery_id or not event:
        return Response(status_code=204)

    watchers = WatcherService(session)
    if await watchers.is_duplicate_delivery(delivery_id):
        logger.info("Duplicate webhook delivery ignored => delivery_id=%s", delivery_id)
        return Response(status_code=204)

    if event not in _HANDLED_EVENTS:
        return Response(status_code=204)

    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return Response(status_code=204)

    if event == "pull_request":
        await watchers.handle_pull_request(payload)
    elif event == "issues":
        await watchers.handle_issues(payload)

    return Response(status_code=204)

"""Container management: only meaningful when RUN_EXECUTOR=docker.

Every route raises NotImplementedError (-> 501, registered in main.py) when
the local executor is active, per the plan's explicit contract — there is
nothing to list/inspect/stop with subprocesses.
"""

from typing import Annotated

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from orquesta_api.config import settings
from orquesta_api.core.integrations.docker_client import DockerClient, container_from_attrs
from orquesta_api.meta.models import Container

router = APIRouter(prefix="/containers", tags=["containers"])
images_router = APIRouter(prefix="/images", tags=["containers"])

_client = DockerClient()


def _require_docker_executor() -> None:
    if settings.run_executor != "docker":
        raise NotImplementedError(
            f"Container endpoints require RUN_EXECUTOR=docker (currently {settings.run_executor!r})"
        )


@router.get("")
async def list_containers(project: Annotated[str | None, Query()] = None) -> list[Container]:
    """List every orquesta-managed container, optionally scoped to one project."""
    _require_docker_executor()
    raw = await _client.list_managed(project_id=project)
    return [container_from_attrs(attrs) for attrs in raw]


@router.get("/{container_id}")
async def inspect_container(container_id: str) -> Container:
    """Return live state for one container."""
    _require_docker_executor()
    attrs = await _client.inspect(container_id)
    return container_from_attrs(attrs)


@router.get("/{container_id}/logs")
async def container_logs(
    container_id: str, tail: Annotated[int | None, Query(ge=0)] = None
) -> StreamingResponse:
    """Stream a container's stdout/stderr as SSE events."""
    _require_docker_executor()

    async def _stream():
        async for line in _client.logs(container_id, tail=tail):
            yield f"data: {line}\n\n"

    return StreamingResponse(_stream(), media_type="text/event-stream")


@router.post("/{container_id}/stop", status_code=204)
async def stop_container(container_id: str) -> None:
    """Stop a container gracefully (SIGTERM, then SIGKILL after the default timeout)."""
    _require_docker_executor()
    await _client.stop(container_id)


@router.post("/{container_id}/restart", status_code=204)
async def restart_container(container_id: str) -> None:
    """Restart a container in place."""
    _require_docker_executor()
    await _client.restart(container_id)


class ImagePullRequest(BaseModel):
    """Request body for POST /images/pull."""

    image: str


@images_router.post("/pull", status_code=204)
async def pull_image(body: ImagePullRequest) -> None:
    """Pull an image (e.g. a new orq-lite version) before it's referenced by a run."""
    _require_docker_executor()
    await _client.pull_image(body.image)

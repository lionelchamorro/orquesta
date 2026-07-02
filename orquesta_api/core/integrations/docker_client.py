"""Async facade over the docker SDK's synchronous DockerClient.

Every docker-py call is a blocking HTTP request to the Engine API over a
Unix socket (or TCP), so every method here offloads to a thread via
asyncio.to_thread rather than blocking the event loop.
"""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

from orquesta_api.logger import get_logger
from orquesta_api.meta.models import Container, ContainerState

logger = get_logger(__name__)

MANAGED_LABEL = "orquesta.managed"
PROJECT_LABEL = "orquesta.project"
RUN_LABEL = "orquesta.run"


def container_from_attrs(attrs: dict[str, Any], run_id: str | None = None) -> Container:
    """Build a Container model from a raw `docker inspect`-shaped attrs dict."""
    state = attrs.get("State", {}) or {}
    config = attrs.get("Config", {}) or {}
    labels = config.get("Labels", {}) or {}

    try:
        container_state = ContainerState(state.get("Status", ""))
    except ValueError:
        container_state = ContainerState.dead

    return Container(
        id=attrs.get("Id", ""),
        run_id=run_id or labels.get(RUN_LABEL),
        project_id=labels.get(PROJECT_LABEL),
        image=config.get("Image", ""),
        state=container_state,
        health=(state.get("Health", {}) or {}).get("Status"),
        # Real `docker inspect` output always has Created; default defensively
        # rather than let a malformed/partial attrs dict 500 the request.
        created_at=attrs.get("Created") or datetime.now(tz=UTC),
        ports={},
        name=(attrs.get("Name", "") or "").lstrip("/"),
    )


class DockerClient:
    """Thin async wrapper; every method offloads its blocking call to a thread.

    Parameters
    ----------
    sdk_client:
        Optional pre-built ``docker.DockerClient``-shaped object. Tests pass
        a fake implementing the small subset of the API used here
        (``containers.run/get/list``, ``images.pull``); production code
        leaves this ``None`` and gets a lazily-created ``docker.from_env()``
        client on first use.
    """

    def __init__(self, sdk_client: Any | None = None) -> None:
        self._client = sdk_client

    def _get_client(self) -> Any:
        if self._client is None:
            import docker as docker_sdk

            self._client = docker_sdk.from_env()
        return self._client

    async def run_container(
        self,
        image: str,
        command: list[str],
        *,
        name: str,
        labels: dict[str, str],
        volumes: dict[str, dict[str, str]],
        environment: dict[str, str] | None = None,
    ) -> str:
        """Start a detached container; returns its id."""

        def _run() -> str:
            container = self._get_client().containers.run(
                image,
                command,
                name=name,
                labels=labels,
                volumes=volumes,
                environment=environment or {},
                detach=True,
            )
            return container.id

        return await asyncio.to_thread(_run)

    # ast-grep-ignore: no-dict-return-annotation
    async def inspect(self, container_id: str) -> dict[str, Any]:
        # ast-grep-ignore: no-dict-return-annotation
        def _inspect() -> dict[str, Any]:
            return self._get_client().containers.get(container_id).attrs

        return await asyncio.to_thread(_inspect)

    async def wait(self, container_id: str) -> int:
        def _wait() -> int:
            result = self._get_client().containers.get(container_id).wait()
            return int(result.get("StatusCode", -1))

        return await asyncio.to_thread(_wait)

    async def stop(self, container_id: str, timeout: int = 10) -> None:
        def _stop() -> None:
            self._get_client().containers.get(container_id).stop(timeout=timeout)

        await asyncio.to_thread(_stop)

    async def restart(self, container_id: str, timeout: int = 10) -> None:
        def _restart() -> None:
            self._get_client().containers.get(container_id).restart(timeout=timeout)

        await asyncio.to_thread(_restart)

    async def logs(self, container_id: str, tail: int | None = None) -> AsyncIterator[str]:
        def _fetch() -> list[str]:
            container = self._get_client().containers.get(container_id)
            kwargs: dict[str, Any] = {"stdout": True, "stderr": True}
            if tail is not None:
                kwargs["tail"] = tail
            raw: bytes = container.logs(**kwargs)
            return raw.decode(errors="replace").splitlines()

        for line in await asyncio.to_thread(_fetch):
            yield line

    async def list_managed(self, project_id: str | None = None) -> list[dict[str, Any]]:
        """List containers labeled orquesta.managed=true, optionally scoped to a project."""

        def _list() -> list[dict[str, Any]]:
            label_filters = [f"{MANAGED_LABEL}=true"]
            if project_id:
                label_filters.append(f"{PROJECT_LABEL}={project_id}")
            containers = self._get_client().containers.list(
                all=True, filters={"label": label_filters}
            )
            return [c.attrs for c in containers]

        return await asyncio.to_thread(_list)

    async def pull_image(self, image: str) -> None:
        def _pull() -> None:
            self._get_client().images.pull(image)

        await asyncio.to_thread(_pull)

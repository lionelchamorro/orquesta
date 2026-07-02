"""Docker-backed run executor: runs orq-lite as a sibling container per run."""

from collections.abc import AsyncIterator
from pathlib import Path

from orquesta_api.config import settings
from orquesta_api.core.integrations.docker_client import (
    MANAGED_LABEL,
    PROJECT_LABEL,
    RUN_LABEL,
    DockerClient,
    container_from_attrs,
)
from orquesta_api.executors.local import build_argv
from orquesta_api.logger import get_logger
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Container, RunHandle, RunSpec, RunState

logger = get_logger(__name__)


def _creds_volumes() -> dict[str, dict[str, str]]:
    """Mount every path in settings.creds_mounts read-only, keyed by resolved host path."""
    volumes: dict[str, dict[str, str]] = {}
    for raw in settings.creds_mounts.split(","):
        raw = raw.strip()
        if not raw:
            continue
        host_path = Path(raw).expanduser().resolve()
        volumes[str(host_path)] = {"bind": f"/root/{host_path.name}", "mode": "ro"}
    return volumes


class DockerExecutor(ExecutorInterface):
    """Executes runs as containers on the local Docker Engine instead of local subprocesses."""

    def __init__(self, client: DockerClient | None = None, image: str | None = None) -> None:
        self._client = client or DockerClient()
        self._image = image or settings.orq_lite_image

    async def start(self, spec: RunSpec, run_id: str = "") -> RunHandle:
        # The image's ENTRYPOINT is the orq-lite binary itself; drop the
        # leading bin-path token that build_argv prepends for the local
        # subprocess case.
        command = build_argv("orq-lite", spec)[1:]

        volumes = {
            str(Path(spec.workspace_path).resolve()): {"bind": "/workspace", "mode": "rw"},
            **_creds_volumes(),
        }
        labels = {MANAGED_LABEL: "true", PROJECT_LABEL: spec.project_id, RUN_LABEL: run_id}

        container_id = await self._client.run_container(
            self._image,
            command,
            name=f"orquesta-run-{run_id}",
            labels=labels,
            volumes=volumes,
            environment={"HOME": "/root"},
        )
        logger.info("Started container => run_id=%s container_id=%s", run_id, container_id[:12])
        return RunHandle(container_id=container_id, run_id=run_id)

    async def stop(self, handle: RunHandle, grace_s: int = 10) -> None:
        if handle.container_id is not None:
            await self._client.stop(handle.container_id, timeout=grace_s)

    async def status(self, handle: RunHandle) -> RunState:
        if handle.container_id is None:
            return RunState.failed
        try:
            attrs = await self._client.inspect(handle.container_id)
        except Exception:
            return RunState.failed

        state = attrs.get("State", {}) or {}
        if state.get("Running"):
            return RunState.running
        return RunState.succeeded if state.get("ExitCode", 1) == 0 else RunState.failed

    async def wait(self, handle: RunHandle) -> int:
        if handle.container_id is None:
            return -1
        return await self._client.wait(handle.container_id)

    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]:
        return self._logs_gen(handle, tail)

    async def _logs_gen(self, handle: RunHandle, tail: int | None) -> AsyncIterator[str]:
        if handle.container_id is None:
            return
        async for line in self._client.logs(handle.container_id, tail=tail):
            yield line

    async def inspect(self, handle: RunHandle) -> Container | None:
        if handle.container_id is None:
            return None
        try:
            attrs = await self._client.inspect(handle.container_id)
        except Exception:
            return None
        return container_from_attrs(attrs, run_id=handle.run_id)

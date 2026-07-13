"""Run executor and workspace preparation helpers."""

import asyncio
from pathlib import Path

from orquesta_api.config import settings
from orquesta_api.logger import get_logger
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.services.examples_overlay import overlay_examples

logger = get_logger(__name__)

_LOCAL_EXECUTOR: ExecutorInterface | None = None
_DOCKER_EXECUTOR: ExecutorInterface | None = None


def make_executor() -> ExecutorInterface:
    """Return the configured process-wide executor singleton."""
    global _LOCAL_EXECUTOR, _DOCKER_EXECUTOR
    if settings.run_executor == "local":
        from orquesta_api.executors.local import LocalExecutor

        if _LOCAL_EXECUTOR is None:
            _LOCAL_EXECUTOR = LocalExecutor()
        return _LOCAL_EXECUTOR
    if settings.run_executor == "docker":
        from orquesta_api.executors.docker import DockerExecutor

        if _DOCKER_EXECUTOR is None:
            _DOCKER_EXECUTOR = DockerExecutor()
        return _DOCKER_EXECUTOR
    raise ValueError(f"Unknown executor '{settings.run_executor}'")


async def ensure_workspace_ready(workspace: str, bin_path: str) -> None:
    """Run ``orq-lite init`` in *workspace* if ``team.json`` is absent."""
    if not (Path(workspace) / "team.json").exists():
        logger.info("Initialising workspace => path=%s", workspace)
        proc = await asyncio.create_subprocess_exec(
            bin_path,
            "init",
            cwd=workspace,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        exit_code = await proc.wait()
        if exit_code != 0:
            raise RuntimeError(
                f"orq-lite init failed (exit {exit_code}) in workspace {workspace!r}"
            )

    overlay_examples(workspace)

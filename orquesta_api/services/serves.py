"""Persistent orq-lite serve manager — one read-only serve process per project."""

import asyncio
import contextlib
import socket
from collections.abc import Awaitable, Callable

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.config import settings
from orquesta_api.db.tables import ProjectRow
from orquesta_api.logger import get_logger
from orquesta_api.services.examples_overlay import overlay_examples

logger = get_logger(__name__)

HealthCheck = Callable[[int], Awaitable[bool]]


def _find_free_port() -> int:
    """Bind to port 0 and return the OS-assigned ephemeral port number."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _default_health_check(port: int) -> bool:
    """Retry GET /api/tasks up to 5 times at 200 ms intervals."""
    for _ in range(5):
        with contextlib.suppress(Exception):
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    f"http://127.0.0.1:{port}/api/tasks",
                    timeout=1.0,
                )
                if resp.status_code == 200:
                    return True
        await asyncio.sleep(0.2)
    return False


class ServeManager:
    """Spawn and track one orq-lite serve process per project.

    The serve is read-only: it only runs ``orq-lite serve`` (a GET-only
    process) and never writes to the workspace.
    """

    def __init__(
        self,
        bin_path: str | None = None,
        health_check: HealthCheck | None = None,
    ) -> None:
        self._bin = bin_path or settings.orq_lite_bin
        self._processes: dict[str, asyncio.subprocess.Process] = {}
        self._ports: dict[str, int] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._health_check: HealthCheck = health_check or _default_health_check

    def _lock(self, project_id: str) -> asyncio.Lock:
        if project_id not in self._locks:
            self._locks[project_id] = asyncio.Lock()
        return self._locks[project_id]

    async def ensure(self, project_id: str, workspace: str) -> int:
        """Ensure a serve is running for *project_id*; idempotent.

        Spawns ``orq-lite serve --addr 127.0.0.1:<free-port>`` in *workspace*
        if no live process exists, then waits for the health check to pass.
        Returns the port number.

        Raises ``RuntimeError`` if the health check never passes.
        """
        async with self._lock(project_id):
            proc = self._processes.get(project_id)
            if proc is not None and proc.returncode is None:
                port = self._ports[project_id]
                logger.info("Serve already running => project_id=%s port=%d", project_id, port)
                return port

            # Overlay the example flows/teams before serving so they show up in
            # the flow catalog without launching a run first. Idempotent.
            overlay_examples(workspace)

            port = _find_free_port()
            addr = f"127.0.0.1:{port}"
            cmd = [self._bin, "serve", "--addr", addr]
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=workspace,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            self._processes[project_id] = proc
            self._ports[project_id] = port
            logger.info(
                "Spawned serve => project_id=%s pid=%d port=%d",
                project_id,
                proc.pid,
                port,
            )

            healthy = await self._health_check(port)
            if not healthy:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5.0)
                except TimeoutError:
                    proc.kill()
                    await proc.wait()
                self._processes.pop(project_id, None)
                self._ports.pop(project_id, None)
                raise RuntimeError(f"orq-lite serve health-check failed for project {project_id!r}")

            return port

    async def stop(self, project_id: str) -> None:
        """Terminate the serve process for *project_id* if one is running."""
        async with self._lock(project_id):
            proc = self._processes.pop(project_id, None)
            self._ports.pop(project_id, None)
            if proc is not None and proc.returncode is None:
                proc.terminate()
                try:
                    await asyncio.wait_for(proc.wait(), timeout=5.0)
                except TimeoutError:
                    proc.kill()
                    await proc.wait()
                logger.info("Stopped serve => project_id=%s", project_id)

    async def start_all(self, session: AsyncSession) -> None:
        """On startup: launch a serve for every registered project that has a workspace.

        Updates ``ProjectRow.serve_port`` with the live port.
        Projects whose serve fails to start are logged as warnings and skipped.
        """
        result = await session.execute(select(ProjectRow))
        rows = list(result.scalars().all())
        for row in rows:
            if not row.workspace_path:
                continue
            try:
                port = await self.ensure(row.id, row.workspace_path)
                row.serve_port = port
            except Exception as exc:
                logger.warning("Could not start serve => project_id=%s error=%s", row.id, exc)
        await session.commit()

    async def shutdown(self) -> None:
        """Stop all managed serve processes."""
        for project_id in list(self._processes):
            await self.stop(project_id)
        logger.info("ServeManager shutdown complete")

    def port(self, project_id: str) -> int | None:
        """Return the live port for *project_id*, or ``None`` if not running."""
        proc = self._processes.get(project_id)
        if proc is None or proc.returncode is not None:
            return None
        return self._ports.get(project_id)

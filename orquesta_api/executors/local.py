"""Local subprocess executor backend."""

import asyncio
import socket
from collections.abc import AsyncGenerator, AsyncIterator

from orquesta_api.config import settings
from orquesta_api.logger import get_logger
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Container, RunHandle, RunSpec, RunState

logger = get_logger(__name__)


def _find_free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class LocalExecutor(ExecutorInterface):
    """Execute runs as local subprocesses."""

    def __init__(self, bin_path: str | None = None) -> None:
        self._bin = bin_path or settings.orq_lite_bin
        self._processes: dict[int, asyncio.subprocess.Process] = {}
        self._log_cache: dict[int, list[str]] = {}
        self._reader_tasks: dict[int, asyncio.Task[None]] = {}

    async def start(self, spec: RunSpec) -> RunHandle:
        """Spawn orq-lite and return a handle with pid and api_port."""
        port = _find_free_port()
        cmd = [self._bin, "--addr", f"127.0.0.1:{port}", *spec.args]
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        pid = process.pid
        self._processes[pid] = process
        self._log_cache[pid] = []
        self._reader_tasks[pid] = asyncio.create_task(self._collect_output(pid))
        logger.info("Started process => pid=%s port=%s", pid, port)
        return RunHandle(pid=pid, api_port=port)

    async def stop(self, handle: RunHandle, grace_s: int = 10) -> None:
        """SIGTERM the process; escalate to SIGKILL after grace_s seconds."""
        if handle.pid is None:
            return
        process = self._processes.get(handle.pid)
        if process is None or process.returncode is not None:
            return
        process.terminate()
        try:
            await asyncio.wait_for(process.wait(), timeout=float(grace_s))
        except TimeoutError:
            process.kill()
            await process.wait()
        logger.info("Stopped process => pid=%s", handle.pid)

    async def status(self, handle: RunHandle) -> RunState:
        """Map process returncode to RunState."""
        if handle.pid is None:
            return RunState.failed
        process = self._processes.get(handle.pid)
        if process is None:
            return RunState.failed
        returncode = process.returncode
        if returncode is None:
            return RunState.running
        return RunState.succeeded if returncode == 0 else RunState.failed

    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]:
        """Return an async iterator over captured stdout lines."""
        return self._logs_gen(handle, tail)

    async def inspect(self, handle: RunHandle) -> Container | None:
        """Return None — local executor does not manage containers."""
        return None

    async def _collect_output(self, pid: int) -> None:
        process = self._processes[pid]
        if process.stdout is None:
            return
        while True:
            line = await process.stdout.readline()
            if not line:
                break
            self._log_cache[pid].append(line.decode().rstrip("\r\n"))
        await process.wait()

    async def _logs_gen(
        self, handle: RunHandle, tail: int | None = None
    ) -> AsyncGenerator[str, None]:
        if handle.pid is None:
            return
        cache = self._log_cache.get(handle.pid)
        if cache is None:
            return

        if tail is not None:
            for line in ([] if tail == 0 else cache[-tail:]):
                yield line
            return

        # Live streaming: yield cached lines then follow new ones until reader exits.
        task = self._reader_tasks.get(handle.pid)
        pos = 0
        while True:
            while pos < len(cache):
                yield cache[pos]
                pos += 1
            if task is None or task.done():
                # Final drain after task finishes (list is append-only; no lock needed).
                while pos < len(cache):
                    yield cache[pos]
                    pos += 1
                break
            await asyncio.sleep(0.05)

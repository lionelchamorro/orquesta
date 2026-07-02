"""Local subprocess executor backend."""

import asyncio
import collections
import io
from collections.abc import AsyncGenerator, AsyncIterator
from pathlib import Path

from orquesta_api.config import settings
from orquesta_api.logger import get_logger
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Container, RunHandle, RunKind, RunSpec, RunState

logger = get_logger(__name__)


def build_argv(bin_path: str, spec: RunSpec) -> list[str]:
    """Map a RunSpec to the exact orq-lite CLI invocation (subcommand first).

    orq-lite reads os.Args[1] as the subcommand; all flags must follow it.
    Runs are headless — the per-project serve (Task 2) owns the dashboard.
    """
    match spec.kind:
        case RunKind.run:
            argv = [bin_path, "run"]
        case RunKind.factory:
            # The per-project serve (Task 2) owns the dashboard; keep runs headless.
            argv = [bin_path, "factory", "--serve=false"]
            if spec.plan_path:
                argv.append(spec.plan_path)
        case RunKind.plan:
            if not spec.plan_path:
                raise ValueError("plan runs require plan_path")
            argv = [bin_path, "plan", spec.plan_path]
        case RunKind.flow:
            if not spec.flow:
                raise ValueError("flow runs require a flow name")
            argv = [bin_path, "flow", "run", spec.flow]
            argv.extend(f"{k}={v}" for k, v in spec.inputs.items())
        case RunKind.watch:
            argv = [bin_path, "watch", "--prs", "--issues"]
    return [*argv, *spec.args]


class LocalExecutor(ExecutorInterface):
    """Execute runs as local subprocesses."""

    def __init__(self, bin_path: str | None = None, log_dir: Path | None = None) -> None:
        self._bin = bin_path or settings.orq_lite_bin
        # Default log directory: sibling of workspaces_dir named "run-logs"
        self._log_dir: Path = log_dir or (
            Path(settings.workspaces_dir).resolve().parent / "run-logs"
        )
        self._processes: dict[int, asyncio.subprocess.Process] = {}
        # Bounded deque: in-memory cache capped at 5000 lines per process.
        # NOTE: Live streaming tracks position by index; once >5000 lines are
        # produced in a single run, lines beyond the 5000th may be skipped in
        # the live stream. The disk mirror (run-logs/<run_id>.log) retains all.
        self._log_cache: dict[int, collections.deque[str]] = {}
        self._log_file_handles: dict[int, io.TextIOWrapper | None] = {}
        self._reader_tasks: dict[int, asyncio.Task[None]] = {}

    async def start(self, spec: RunSpec, run_id: str = "") -> RunHandle:
        """Spawn orq-lite in the project workspace; return a handle with pid."""
        cmd = build_argv(self._bin, spec)
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=spec.workspace_path or None,
        )
        pid = process.pid
        self._processes[pid] = process
        self._log_cache[pid] = collections.deque(maxlen=5000)

        # Open disk mirror for this run (skipped when run_id is empty, e.g. direct tests).
        if run_id:
            self._log_dir.mkdir(parents=True, exist_ok=True)
            log_path = self._log_dir / f"{run_id}.log"
            self._log_file_handles[pid] = log_path.open("w")
        else:
            self._log_file_handles[pid] = None

        self._reader_tasks[pid] = asyncio.create_task(self._collect_output(pid))
        logger.info(
            "Started process => pid=%s cwd=%s cmd=%s", pid, spec.workspace_path, " ".join(cmd)
        )
        return RunHandle(pid=pid, run_id=run_id or None)

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

    async def wait(self, handle: RunHandle) -> int:
        """Await the tracked process and return its exit code.

        Safe to call multiple times; asyncio Process.wait() is idempotent once
        the process has exited. Returns -1 if the handle is unknown (e.g. after
        an API restart — pids do not survive a process restart).
        """
        if handle.pid is None:
            return -1
        process = self._processes.get(handle.pid)
        if process is None:
            return -1
        await process.wait()
        return process.returncode if process.returncode is not None else -1

    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]:
        """Return an async iterator over captured stdout lines."""
        return self._logs_gen(handle, tail)

    async def inspect(self, handle: RunHandle) -> Container | None:
        """Return None — local executor does not manage containers."""
        return None

    async def _collect_output(self, pid: int) -> None:
        process = self._processes[pid]
        fh = self._log_file_handles.get(pid)
        if process.stdout is None:
            if fh is not None:
                fh.close()
            return
        try:
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                decoded = line.decode().rstrip("\r\n")
                self._log_cache[pid].append(decoded)
                if fh is not None:
                    fh.write(decoded + "\n")
                    fh.flush()
        finally:
            await process.wait()
            if fh is not None:
                fh.close()
            self._log_file_handles[pid] = None

    async def _logs_gen(
        self, handle: RunHandle, tail: int | None = None
    ) -> AsyncGenerator[str, None]:
        # Try in-memory cache first (process was started in this executor instance).
        cache = None
        if handle.pid is not None:
            cache = self._log_cache.get(handle.pid)

        if cache is not None:
            async for line in self._logs_from_cache(handle, cache, tail):
                yield line
        else:
            async for line in self._logs_from_disk(handle, tail):
                yield line

    async def _logs_from_cache(
        self,
        handle: RunHandle,
        cache: collections.deque[str],
        tail: int | None,
    ) -> AsyncGenerator[str, None]:
        """Yield lines from the in-memory log cache (live or tail)."""
        if tail is not None:
            # deque does not support slice notation; convert to list for slicing.
            tail_lines = list(cache)[-tail:] if tail > 0 else []
            for line in tail_lines:
                yield line
            return

        # Live streaming: yield cached lines then follow new ones until reader exits.
        # Uses position-based indexing (O(n) on deque but cache is capped at 5000).
        # A cache hit implies handle.pid was set, but the type doesn't know that.
        task = self._reader_tasks.get(handle.pid) if handle.pid is not None else None
        pos = 0
        while True:
            while pos < len(cache):
                yield cache[pos]
                pos += 1
            if task is None or task.done():
                # Final drain after task finishes (append-only from right; no lock needed).
                while pos < len(cache):
                    yield cache[pos]
                    pos += 1
                break
            await asyncio.sleep(0.05)

    async def _logs_from_disk(
        self, handle: RunHandle, tail: int | None
    ) -> AsyncGenerator[str, None]:
        """Disk fallback: used after a control-plane restart when _log_cache is empty.

        A process that left no in-memory cache has already exited; read the disk
        mirror once and stop — no busy-loop needed.
        """
        if handle.run_id is None:
            return
        log_file = self._log_dir / f"{handle.run_id}.log"
        if not log_file.exists():
            return
        lines = log_file.read_text().splitlines()
        if tail is not None:
            for line in lines[-tail:] if tail > 0 else []:
                yield line
        else:
            # live-follow with disk fallback: yield all lines once and terminate.
            for line in lines:
                yield line

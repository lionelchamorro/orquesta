"""Executor test doubles and wait helpers shared by the run-queue tests."""

import asyncio
from collections.abc import AsyncIterator

from orquesta_api.db.tables import RunRow
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Container, RunHandle, RunSpec, RunState
from orquesta_api.services import runs as runs_module


class QueueExecutor(ExecutorInterface):
    """Executor test double whose waits complete only when the test releases them."""

    def __init__(self) -> None:
        self.started: dict[str, RunSpec] = {}
        self._pid = 1000
        self._by_pid: dict[int, str] = {}
        self._waits: dict[int, asyncio.Future[int]] = {}
        self.stop_calls = 0
        self.status_calls = 0

    async def start(self, spec: RunSpec, run_id: str = "") -> RunHandle:
        self._pid += 1
        pid = self._pid
        self.started[run_id] = spec
        self._by_pid[pid] = run_id
        self._waits[pid] = asyncio.get_running_loop().create_future()
        return RunHandle(pid=pid, run_id=run_id)

    async def stop(self, handle: RunHandle, grace_s: int = 10) -> None:
        self.stop_calls += 1
        if handle.pid is not None and handle.pid in self._waits:
            self._waits[handle.pid].set_result(0)

    async def status(self, handle: RunHandle) -> RunState:
        self.status_calls += 1
        if handle.pid is None:
            return RunState.failed
        wait = self._waits.get(handle.pid)
        if wait is None:
            return RunState.failed
        if not wait.done():
            return RunState.running
        return RunState.succeeded if wait.result() == 0 else RunState.failed

    async def wait(self, handle: RunHandle) -> int:
        if handle.pid is None:
            return 1
        return await self._waits[handle.pid]

    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]:
        return self._empty_logs()

    async def _empty_logs(self) -> AsyncIterator[str]:
        if False:
            yield ""

    async def inspect(self, handle: RunHandle) -> Container | None:
        return None

    def finish(self, pid: int, exit_code: int = 0) -> None:
        self._waits[pid].set_result(exit_code)


class BlockingStartExecutor(QueueExecutor):
    """Executor fake that pauses starts so concurrent drain claims can overlap."""

    def __init__(self) -> None:
        super().__init__()
        self.first_start_entered = asyncio.Event()
        self.release_starts = asyncio.Event()

    async def start(self, spec: RunSpec, run_id: str = "") -> RunHandle:
        self._pid += 1
        pid = self._pid
        self.started[run_id] = spec
        self._by_pid[pid] = run_id
        self._waits[pid] = asyncio.get_running_loop().create_future()
        self.first_start_entered.set()
        await self.release_starts.wait()
        return RunHandle(pid=pid, run_id=run_id)


async def wait_for_supervisor_tasks() -> None:
    tasks = list(runs_module._SUPERVISOR_TASKS)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def wait_for_run_state(db, run_id: str, state: RunState) -> RunRow:
    for _ in range(200):
        async with db() as session:
            row = await session.get(RunRow, run_id)
            if row is not None and row.state == state.value:
                return row
        await asyncio.sleep(0.01)
    raise AssertionError(f"run {run_id} did not reach {state.value}")

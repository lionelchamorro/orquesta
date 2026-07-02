"""Correlates orquesta launch records with orq-lite's own run ids (Task 9).

orq-lite stamps every run.log event with its internal run_id once the run
starts. The EventIngestManager already relays those events onto the bus
stamped with the project; this subscriber watches for run_start events and
writes the orq run_id onto the project's active RunRow — the 1:1 link that
lets the frontend jump from an orquesta launch record into the serve's
query-API history.
"""

import asyncio
import contextlib
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from orquesta_api.db.tables import RunRow
from orquesta_api.logger import get_logger
from orquesta_api.meta.models import EventKind, RunEvent, RunState
from orquesta_api.services.events import EventBus

logger = get_logger(__name__)

_ACTIVE_STATES = [
    RunState.queued.value,
    RunState.starting.value,
    RunState.running.value,
    RunState.stopping.value,
]

# The SSE consumer replays the last ~100 run.log lines on every (re)connect,
# so a run_start from a PREVIOUS run can arrive while a new RunRow is active.
# Guard: only accept a run_start whose timestamp is not meaningfully older
# than the RunRow's own launch time (small skew tolerance; both clocks are
# the same machine).
_MAX_EVENT_AGE_SKEW = timedelta(seconds=5)


def _parse_ts(raw: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


class RunCorrelator:
    """Background task: run_start events -> RunRow.orq_run_id."""

    def __init__(self, bus: EventBus, session_maker: async_sessionmaker[AsyncSession]) -> None:
        self._bus = bus
        self._session_maker = session_maker
        self._task: asyncio.Task[None] | None = None
        # Set once the bus subscription exists — events published before this
        # would be silently missed (create_task schedules, it doesn't run).
        self._ready = asyncio.Event()

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._run())

    async def wait_ready(self) -> None:
        """Block until the bus subscription is live (used by tests and startup)."""
        await self._ready.wait()

    async def shutdown(self) -> None:
        if self._task is not None:
            self._task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._task
            self._task = None
            self._ready.clear()

    async def _run(self) -> None:
        async with self._bus.subscribe(project_id=None) as queue:
            self._ready.set()
            while True:
                event = await queue.get()
                try:
                    await self._handle(event)
                except Exception as exc:
                    logger.warning("run correlation failed => error=%s", exc)

    async def _handle(self, event: RunEvent) -> None:
        if event.event is not EventKind.run_start or not event.project:
            return
        orq_run_id = getattr(event, "run_id", None)
        if not orq_run_id:
            return

        event_ts = _parse_ts(event.ts)

        async with self._session_maker() as session:
            result = await session.execute(
                select(RunRow).where(
                    RunRow.project_id == event.project,
                    RunRow.state.in_(_ACTIVE_STATES),
                )
            )
            row = result.scalars().first()
            if row is None:
                return

            # Reject replayed run_start events from before this launch.
            if event_ts is not None and row.started_at is not None:
                started_at = (
                    row.started_at if row.started_at.tzinfo else row.started_at.replace(tzinfo=UTC)
                )
                if event_ts < started_at - _MAX_EVENT_AGE_SKEW:
                    return

            if row.orq_run_id == orq_run_id:
                return
            row.orq_run_id = str(orq_run_id)
            await session.commit()
            logger.info(
                "Correlated run => run_id=%s orq_run_id=%s project=%s",
                row.id,
                orq_run_id,
                event.project,
            )

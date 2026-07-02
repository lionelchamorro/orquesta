"""In-process event bus for run lifecycle events and (future) orq-lite SSE relay.

Publishers and subscribers share one process-wide :class:`EventBus` via
``get_event_bus()``, mirroring the ``_LOCAL_EXECUTOR`` singleton pattern in
``services/runs.py`` — routers construct short-lived service objects per
request, so the bus itself must outlive any single request.
"""

import asyncio
import contextlib
from collections.abc import AsyncIterator

from orquesta_api.logger import get_logger
from orquesta_api.meta.models import RunEvent

logger = get_logger(__name__)

# Bounded so a stalled subscriber (e.g. a dropped SSE connection whose queue
# nobody drains) cannot grow without limit; oldest events are dropped first.
_SUBSCRIBER_QUEUE_MAXSIZE = 1000


class EventBus:
    """Fan-out publisher: every subscriber gets its own bounded queue."""

    def __init__(self) -> None:
        self._global_subscribers: set[asyncio.Queue[RunEvent]] = set()
        self._project_subscribers: dict[str, set[asyncio.Queue[RunEvent]]] = {}

    async def publish(self, event: RunEvent) -> None:
        """Fan *event* out to the global feed and, if stamped, its project feed."""
        for queue in list(self._global_subscribers):
            self._offer(queue, event)
        if event.project:
            for queue in list(self._project_subscribers.get(event.project, ())):
                self._offer(queue, event)

    @staticmethod
    def _offer(queue: asyncio.Queue[RunEvent], event: RunEvent) -> None:
        if queue.full():
            with contextlib.suppress(asyncio.QueueEmpty):
                queue.get_nowait()
        queue.put_nowait(event)

    @contextlib.asynccontextmanager
    async def subscribe(
        self, project_id: str | None = None
    ) -> AsyncIterator[asyncio.Queue[RunEvent]]:
        """Yield a queue that receives every event for *project_id* (or all, if None)."""
        queue: asyncio.Queue[RunEvent] = asyncio.Queue(maxsize=_SUBSCRIBER_QUEUE_MAXSIZE)
        registry = (
            self._global_subscribers
            if project_id is None
            else self._project_subscribers.setdefault(project_id, set())
        )
        registry.add(queue)
        try:
            yield queue
        finally:
            registry.discard(queue)

    def subscriber_count(self, project_id: str | None = None) -> int:
        """Return the number of live subscribers for *project_id* (or the global feed)."""
        if project_id is None:
            return len(self._global_subscribers)
        return len(self._project_subscribers.get(project_id, ()))


_EVENT_BUS: EventBus | None = None


def get_event_bus() -> EventBus:
    """Return the process-wide EventBus singleton, creating it on first use."""
    global _EVENT_BUS
    if _EVENT_BUS is None:
        _EVENT_BUS = EventBus()
    return _EVENT_BUS

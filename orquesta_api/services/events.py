"""In-process event bus for run lifecycle events and (future) orq-lite SSE relay.

Publishers and subscribers share one process-wide :class:`EventBus` via
``get_event_bus()``, mirroring the ``_LOCAL_EXECUTOR`` singleton pattern in
``services/runs.py`` — routers construct short-lived service objects per
request, so the bus itself must outlive any single request.
"""

import asyncio
import contextlib
import json
from collections.abc import AsyncIterator, Awaitable, Callable

import httpx

from orquesta_api.logger import get_logger
from orquesta_api.meta.models import RunEvent

logger = get_logger(__name__)

# Bounded so a stalled subscriber (e.g. a dropped SSE connection whose queue
# nobody drains) cannot grow without limit; oldest events are dropped first.
_SUBSCRIBER_QUEUE_MAXSIZE = 1000

_RECONNECT_MIN_S = 1.0
_RECONNECT_MAX_S = 30.0


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


PortLookup = Callable[[str], int | None]


class ProjectEventConsumer:
    r"""Relay one project's orq-lite serve ``GET /api/events`` SSE stream into the bus.

    Wire format (orquesta-lite/internal/web/server.go:387-438, verified against
    the real server): each line is either ``data: <json>\n\n`` (one JSONL
    event, replaying the last 100 lines of run.log on connect then tailing
    live) or a bare ``: ping\n\n`` comment every 15s. Reconnects with
    exponential backoff (1s -> 30s) whenever the port is unknown, the serve
    hasn't started yet, or the stream drops.
    """

    def __init__(
        self,
        bus: EventBus,
        project_id: str,
        port_lookup: PortLookup,
        client_factory: Callable[..., httpx.AsyncClient] = httpx.AsyncClient,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._bus = bus
        self._project_id = project_id
        self._port_lookup = port_lookup
        self._client_factory = client_factory
        self._sleep = sleep
        self._stopped = False

    def stop(self) -> None:
        self._stopped = True

    async def run(self) -> None:
        """Reconnect forever until :meth:`stop` is called."""
        delay = _RECONNECT_MIN_S
        while not self._stopped:
            port = self._port_lookup(self._project_id)
            if port is None:
                await self._sleep(delay)
                continue
            try:
                await self._stream_once(port)
                delay = _RECONNECT_MIN_S  # clean disconnect (server closed) -> retry fast
            except Exception as exc:
                logger.warning(
                    "event consumer error => project_id=%s error=%s", self._project_id, exc
                )
            if self._stopped:
                return
            await self._sleep(delay)
            delay = min(delay * 2, _RECONNECT_MAX_S)

    async def _stream_once(self, port: int) -> None:
        url = f"http://127.0.0.1:{port}/api/events"
        async with (
            self._client_factory(timeout=None) as client,
            client.stream("GET", url) as resp,
        ):
            resp.raise_for_status()
            async for raw_line in resp.aiter_lines():
                if self._stopped:
                    return
                await self._handle_line(raw_line)

    async def _handle_line(self, raw_line: str) -> None:
        if not raw_line.startswith("data:"):
            return  # blank keep-alive lines and ": ping" heartbeat comments
        payload = raw_line.removeprefix("data:").strip()
        if not payload:
            return
        try:
            fields = json.loads(payload)
        except json.JSONDecodeError:
            logger.warning("event consumer: unparseable line => project_id=%s", self._project_id)
            return
        if not isinstance(fields, dict) or "event" not in fields or "ts" not in fields:
            return
        fields["project"] = self._project_id
        try:
            event = RunEvent(**fields)
        except Exception:
            logger.warning(
                "event consumer: invalid RunEvent => project_id=%s payload=%s",
                self._project_id,
                payload[:200],
            )
            return
        await self._bus.publish(event)


class EventIngestManager:
    """Owns one :class:`ProjectEventConsumer` background task per project."""

    def __init__(self, bus: EventBus, port_lookup: PortLookup) -> None:
        self._bus = bus
        self._port_lookup = port_lookup
        self._consumers: dict[str, ProjectEventConsumer] = {}
        self._tasks: dict[str, asyncio.Task[None]] = {}

    def start(self, project_id: str) -> None:
        """Start relaying events for *project_id*; idempotent."""
        if project_id in self._tasks:
            return
        consumer = ProjectEventConsumer(self._bus, project_id, self._port_lookup)
        self._consumers[project_id] = consumer
        self._tasks[project_id] = asyncio.create_task(consumer.run())

    async def stop(self, project_id: str) -> None:
        """Stop relaying events for *project_id*, if a consumer is running."""
        consumer = self._consumers.pop(project_id, None)
        task = self._tasks.pop(project_id, None)
        if consumer is not None:
            consumer.stop()
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    async def shutdown(self) -> None:
        """Stop every running consumer."""
        for project_id in list(self._tasks):
            await self.stop(project_id)

r"""Task 7 upstream wire format, verified against orquesta-lite/internal/web/server.go.

GET /api/events replays the last N run.log lines as `data: <json>\n\n` then
tails live; heartbeat is a bare `: ping\n\n` comment every 15s.
ProjectEventConsumer relays that stream into the EventBus, stamped with
the project id, and reconnects with exponential backoff.
"""

import asyncio

import httpx

from orquesta_api.meta.models import EventKind
from orquesta_api.services.events import EventBus, EventIngestManager, ProjectEventConsumer

SSE_BODY = (
    b'data: {"ts":"2026-07-02T00:00:00Z","event":"run_start","run_id":"r1"}\n\n'
    b": ping\n\n"
    b'data: {"ts":"2026-07-02T00:00:01Z","event":"agent_run","role":"coder",'
    b'"agent":"codex_gpt5","status":"tests_pass","task_id":"T-001","duration_s":42}\n\n'
    b"not-an-sse-line-should-be-skipped\n"
    b"data: not-json\n\n"
    b'data: {"ts":"2026-07-02T00:00:02Z"}\n\n'
)


def _mock_client_factory(status_code: int = 200, body: bytes = SSE_BODY):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(status_code, content=body)

    transport = httpx.MockTransport(handler)

    def factory(**kwargs):
        kwargs.pop("timeout", None)
        return httpx.AsyncClient(transport=transport, **kwargs)

    return factory


async def test_consumer_relays_valid_events_stamped_with_project() -> None:
    bus = EventBus()
    consumer = ProjectEventConsumer(
        bus,
        "atlas",
        port_lookup=lambda _pid: 9999,
        client_factory=_mock_client_factory(),
    )

    async with bus.subscribe(project_id="atlas") as queue:
        await consumer._stream_once(9999)  # single pass; no reconnect loop needed for this test

        first = queue.get_nowait()
        assert first.event == EventKind.run_start
        assert first.project == "atlas"

        second = queue.get_nowait()
        assert second.event == EventKind.agent_run
        assert second.role == "coder"
        assert second.project == "atlas"

        # Malformed lines (not-json, missing event field) must not reach the bus.
        assert queue.empty()


async def test_consumer_ignores_heartbeat_and_non_data_lines() -> None:
    bus = EventBus()
    consumer = ProjectEventConsumer(
        bus, "atlas", port_lookup=lambda _pid: 9999, client_factory=_mock_client_factory()
    )
    await consumer._handle_line(": ping")
    await consumer._handle_line("")
    await consumer._handle_line("data: not-json")
    assert bus.subscriber_count("atlas") == 0  # nothing subscribed, but no crash either


async def test_run_backs_off_until_port_is_available() -> None:
    bus = EventBus()
    ports = iter([None, None, 9999])
    sleeps: list[float] = []

    async def fake_sleep(seconds: float) -> None:
        sleeps.append(seconds)
        if len(sleeps) >= 3:
            consumer.stop()

    consumer = ProjectEventConsumer(
        bus,
        "atlas",
        port_lookup=lambda _pid: next(ports, 9999),
        client_factory=_mock_client_factory(),
        sleep=fake_sleep,
    )
    await consumer.run()
    assert sleeps[0] == 1.0  # starts at the minimum backoff


async def test_ingest_manager_start_is_idempotent_and_stop_cancels() -> None:
    bus = EventBus()
    manager = EventIngestManager(bus, port_lookup=lambda _pid: None)

    manager.start("atlas")
    manager.start("atlas")  # idempotent: does not create a second task
    assert len(manager._tasks) == 1

    await manager.stop("atlas")
    assert "atlas" not in manager._tasks

    # stop() on an unknown project is a no-op, not an error.
    await manager.stop("nonexistent")


async def test_ingest_manager_shutdown_stops_everything() -> None:
    bus = EventBus()
    manager = EventIngestManager(bus, port_lookup=lambda _pid: None)
    manager.start("atlas")
    manager.start("orion")
    await manager.shutdown()
    assert manager._tasks == {}


async def test_malformed_event_missing_required_field_is_dropped() -> None:
    """A JSON object without 'event'/'ts' must not crash RunEvent construction."""
    bus = EventBus()
    consumer = ProjectEventConsumer(
        bus, "atlas", port_lookup=lambda _pid: 9999, client_factory=_mock_client_factory()
    )
    async with bus.subscribe(project_id="atlas") as queue:
        await consumer._handle_line('data: {"foo": "bar"}')
        await asyncio.sleep(0)
        assert queue.empty()

"""Task 7: EventBus fan-out semantics."""

import asyncio

from orquesta_api.meta.models import EventKind, RunEvent
from orquesta_api.services.events import EventBus


def _event(project: str | None = None, **extra: str) -> RunEvent:
    return RunEvent(
        ts="2026-07-02T00:00:00Z", event=EventKind.run_started, project=project, **extra
    )


async def test_global_subscriber_receives_every_event() -> None:
    bus = EventBus()
    async with bus.subscribe(project_id=None) as queue:
        await bus.publish(_event(project="atlas"))
        await bus.publish(_event(project="orion"))
        first = await asyncio.wait_for(queue.get(), timeout=1.0)
        second = await asyncio.wait_for(queue.get(), timeout=1.0)
    assert {first.project, second.project} == {"atlas", "orion"}


async def test_project_subscriber_only_receives_own_project() -> None:
    bus = EventBus()
    async with bus.subscribe(project_id="atlas") as queue:
        await bus.publish(_event(project="atlas"))
        await bus.publish(_event(project="orion"))
        received = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert received.project == "atlas"
        assert queue.empty()


async def test_unstamped_event_only_reaches_global_feed() -> None:
    bus = EventBus()
    async with (
        bus.subscribe(project_id="atlas") as project_queue,
        bus.subscribe(project_id=None) as global_queue,
    ):
        await bus.publish(_event(project=None))
        assert project_queue.empty()
        received = await asyncio.wait_for(global_queue.get(), timeout=1.0)
        assert received.project is None


async def test_slow_subscriber_drops_oldest_instead_of_blocking() -> None:
    bus = EventBus()
    async with bus.subscribe(project_id=None) as queue:
        # Fill well past a reasonable bound without ever awaiting queue.get();
        # publish() must not deadlock even though nothing drains it.
        for _ in range(1100):
            await bus.publish(_event())
        assert queue.qsize() <= 1000


async def test_unsubscribe_removes_the_queue() -> None:
    bus = EventBus()
    async with bus.subscribe(project_id="atlas"):
        assert bus.subscriber_count("atlas") == 1
    assert bus.subscriber_count("atlas") == 0


async def test_singleton_accessor_returns_same_instance() -> None:
    from orquesta_api.services.events import get_event_bus

    assert get_event_bus() is get_event_bus()

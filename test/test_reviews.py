"""Tests for GET /projects/{id}/reviews and POST /projects/{id}/reviews/{pr}/rerun."""

import asyncio
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import Base, ProjectRow, RunRow
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import Container, RunHandle, RunKind, RunSpec, RunState
from orquesta_api.meta.query_models import OrqRunsPage, OrqRunSummary
from orquesta_api.routers.projects import (
    get_project_reviews,
    rerun_review,
)
from orquesta_api.services import runs as runs_module
from orquesta_api.services.reviews import github_pr_url
from orquesta_api.services.serves import ServeManager


class NoopExecutor(ExecutorInterface):
    """Executor fake that records starts and controls finish timing."""

    def __init__(self) -> None:
        self._pid = 1000
        self._waits: dict[int, asyncio.Future[int]] = {}

    async def start(self, spec: RunSpec, run_id: str = "") -> RunHandle:
        self._pid += 1
        pid = self._pid
        self._waits[pid] = asyncio.get_running_loop().create_future()
        return RunHandle(pid=pid, run_id=run_id)

    async def stop(self, handle: RunHandle, grace_s: int = 10) -> None:
        if handle.pid is not None and handle.pid in self._waits:
            self._waits[handle.pid].set_result(0)

    async def status(self, handle: RunHandle) -> RunState:
        return RunState.failed

    async def wait(self, handle: RunHandle) -> int:
        if handle.pid is None:
            return 1
        return await self._waits[handle.pid]

    def logs(self, handle: RunHandle, tail: int | None = None) -> AsyncIterator[str]:
        return self._empty()

    async def _empty(self) -> AsyncIterator[str]:
        if False:
            yield ""

    async def inspect(self, handle: RunHandle) -> Container | None:
        return None

    def finish(self, pid: int, exit_code: int = 0) -> None:
        self._waits[pid].set_result(exit_code)


@pytest.fixture
async def db(tmp_path: Path):
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker: async_sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    yield maker
    await engine.dispose()


@pytest.fixture
async def project(db, tmp_path: Path) -> str:
    workspace = tmp_path / "ws"
    workspace.mkdir()
    (workspace / "team.json").write_text("{}")
    async with db() as session:
        session.add(
            ProjectRow(
                id="proj1",
                name="Project",
                workspace_path=str(workspace),
                repo_url="https://github.com/acme/atlas",
            )
        )
        await session.commit()
    return "proj1"


@pytest.fixture(autouse=True)
async def _drain():
    yield
    tasks = list(runs_module._SUPERVISOR_TASKS)
    for t in tasks:
        t.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


def test_github_pr_url_https_without_git() -> None:
    assert github_pr_url("https://github.com/acme/atlas", 42) == (
        "https://github.com/acme/atlas/pull/42"
    )


def test_github_pr_url_https_with_git_suffix() -> None:
    assert github_pr_url("https://github.com/acme/atlas.git", 7) == (
        "https://github.com/acme/atlas/pull/7"
    )


def test_github_pr_url_ssh_without_git() -> None:
    assert github_pr_url("git@github.com:acme/atlas", 1) == ("https://github.com/acme/atlas/pull/1")


def test_github_pr_url_ssh_with_git_suffix() -> None:
    assert github_pr_url("git@github.com:acme/atlas.git", 99) == (
        "https://github.com/acme/atlas/pull/99"
    )


def test_github_pr_url_non_github_returns_none() -> None:
    assert github_pr_url("https://gitlab.com/acme/atlas", 1) is None
    assert github_pr_url("https://bitbucket.org/acme/atlas", 1) is None
    assert github_pr_url(None, 1) is None
    assert github_pr_url("", 1) is None


async def test_reviews_only_returns_pr_review_flow_runs(db, project: str) -> None:
    now = datetime.now(tz=UTC)
    async with db() as session:
        session.add(
            RunRow(
                id="rev-1",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="pr_review",
                inputs={"pr_number": "10"},
            )
        )
        session.add(
            RunRow(
                id="run-2",
                project_id=project,
                kind=RunKind.run.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="pr_review",
                inputs={"pr_number": "11"},
            )
        )
        session.add(
            RunRow(
                id="flow-3",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="issue_fix",
                inputs={"issue_number": "5"},
            )
        )
        await session.commit()

        serves = ServeManager()
        reviews = await get_project_reviews(project, session, serves)

    assert len(reviews) == 1
    assert reviews[0].run_id == "rev-1"
    assert reviews[0].pr_number == 10


async def test_reviews_pr_url_github_https(db, project: str) -> None:
    now = datetime.now(tz=UTC)
    async with db() as session:
        session.add(
            RunRow(
                id="rev-gh",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="pr_review",
                inputs={"pr_number": "42"},
            )
        )
        await session.commit()

        serves = ServeManager()
        reviews = await get_project_reviews(project, session, serves)

    assert reviews[0].pr_url == "https://github.com/acme/atlas/pull/42"


async def test_reviews_pr_url_ssh_remote(db, tmp_path: Path) -> None:
    ws = tmp_path / "ws2"
    ws.mkdir()
    (ws / "team.json").write_text("{}")
    async with db() as session:
        session.add(
            ProjectRow(
                id="proj-ssh",
                name="SSH project",
                workspace_path=str(ws),
                repo_url="git@github.com:org/repo.git",
            )
        )
        now = datetime.now(tz=UTC)
        session.add(
            RunRow(
                id="rev-ssh",
                project_id="proj-ssh",
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="pr_review",
                inputs={"pr_number": "7"},
            )
        )
        await session.commit()

        serves = ServeManager()
        reviews = await get_project_reviews("proj-ssh", session, serves)

    assert reviews[0].pr_url == "https://github.com/org/repo/pull/7"


async def test_reviews_pr_url_non_github_is_null(db, tmp_path: Path) -> None:
    ws = tmp_path / "ws3"
    ws.mkdir()
    (ws / "team.json").write_text("{}")
    async with db() as session:
        session.add(
            ProjectRow(
                id="proj-gl",
                name="GitLab project",
                workspace_path=str(ws),
                repo_url="https://gitlab.com/org/repo",
            )
        )
        now = datetime.now(tz=UTC)
        session.add(
            RunRow(
                id="rev-gl",
                project_id="proj-gl",
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="pr_review",
                inputs={"pr_number": "3"},
            )
        )
        await session.commit()

        serves = ServeManager()
        reviews = await get_project_reviews("proj-gl", session, serves)

    assert reviews[0].pr_url is None
    assert reviews[0].pr_number == 3


async def test_reviews_tolerates_non_string_pr_number(db, project: str) -> None:
    now = datetime.now(tz=UTC)
    async with db() as session:
        session.add_all(
            [
                RunRow(
                    id="rev-int",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.succeeded.value,
                    executor="local",
                    created_at=now,
                    flow="pr_review",
                    inputs={"pr_number": 12},
                ),
                RunRow(
                    id="rev-none",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.succeeded.value,
                    executor="local",
                    created_at=now,
                    flow="pr_review",
                    inputs={"pr_number": None},
                ),
            ]
        )
        await session.commit()

        serves = ServeManager()
        reviews = await get_project_reviews(project, session, serves)

    assert [review.pr_number for review in reviews] == [None, None]
    assert [review.pr_url for review in reviews] == [None, None]


async def test_reviews_are_newest_first(db, project: str) -> None:
    older = datetime(2026, 1, 1, tzinfo=UTC)
    newer = datetime(2026, 1, 2, tzinfo=UTC)
    async with db() as session:
        session.add_all(
            [
                RunRow(
                    id="rev-old",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.succeeded.value,
                    executor="local",
                    created_at=older,
                    started_at=older,
                    flow="pr_review",
                    inputs={"pr_number": "1"},
                ),
                RunRow(
                    id="rev-new",
                    project_id=project,
                    kind=RunKind.flow.value,
                    state=RunState.succeeded.value,
                    executor="local",
                    created_at=newer,
                    started_at=newer,
                    flow="pr_review",
                    inputs={"pr_number": "2"},
                ),
            ]
        )
        await session.commit()

        serves = ServeManager()
        reviews = await get_project_reviews(project, session, serves)

    assert [review.run_id for review in reviews] == ["rev-new", "rev-old"]


async def test_reviews_populates_cost_and_duration_from_history(
    db, project: str, monkeypatch
) -> None:
    now = datetime.now(tz=UTC)

    async def fake_list_runs(
        self, project_id: str, limit: int = 50, offset: int = 0, active: bool | None = None
    ) -> OrqRunsPage:
        assert project_id == project
        assert limit == 50
        assert offset == 0
        assert active is None
        return OrqRunsPage(
            runs=[
                OrqRunSummary(
                    run_id="abc123",
                    duration_s=45.0,
                    cost_usd=0.08,
                )
            ],
            total=1,
        )

    async def fail_get_run(self, project_id: str, run_id: str) -> OrqRunSummary:
        raise AssertionError("review listing should batch via list_runs")

    monkeypatch.setattr("orquesta_api.services.aggregator.Aggregator.list_runs", fake_list_runs)
    monkeypatch.setattr("orquesta_api.services.aggregator.Aggregator.get_run", fail_get_run)

    async with db() as session:
        session.add(
            RunRow(
                id="rev-cost",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="pr_review",
                inputs={"pr_number": "44"},
                orq_run_id="abc123",
            )
        )
        await session.commit()

        reviews = await get_project_reviews(project, session, ServeManager())

    assert reviews[0].duration_s == 45.0
    assert reviews[0].cost_usd == 0.08


async def test_reviews_degrades_cost_and_duration_when_history_unreachable(
    db, project: str, monkeypatch
) -> None:
    now = datetime.now(tz=UTC)

    async def fake_list_runs(
        self, project_id: str, limit: int = 50, offset: int = 0, active: bool | None = None
    ) -> OrqRunsPage:
        raise RuntimeError("serve unreachable")

    monkeypatch.setattr("orquesta_api.services.aggregator.Aggregator.list_runs", fake_list_runs)

    async with db() as session:
        session.add(
            RunRow(
                id="rev-cost-unavailable",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="pr_review",
                inputs={"pr_number": "45"},
                orq_run_id="abc123",
            )
        )
        await session.commit()

        reviews = await get_project_reviews(project, session, ServeManager())

    assert reviews[0].duration_s is None
    assert reviews[0].cost_usd is None


async def test_reviews_pages_run_summaries_beyond_default_limit(
    db, project: str, monkeypatch
) -> None:
    now = datetime.now(tz=UTC)
    seen_offsets: list[int] = []

    async def fake_list_runs(
        self, project_id: str, limit: int = 50, offset: int = 0, active: bool | None = None
    ) -> OrqRunsPage:
        assert project_id == project
        assert active is None
        seen_offsets.append(offset)
        runs = [
            OrqRunSummary(
                run_id=f"orq-{index}",
                duration_s=float(index),
                cost_usd=float(index) / 100,
            )
            for index in range(offset, min(offset + limit, 51))
        ]
        return OrqRunsPage(runs=runs, total=51)

    async def fail_get_run(self, project_id: str, run_id: str) -> OrqRunSummary:
        raise AssertionError("review listing should not call get_run per row")

    monkeypatch.setattr("orquesta_api.services.aggregator.Aggregator.list_runs", fake_list_runs)
    monkeypatch.setattr("orquesta_api.services.aggregator.Aggregator.get_run", fail_get_run)

    async with db() as session:
        session.add(
            RunRow(
                id="rev-page-2",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                flow="pr_review",
                inputs={"pr_number": "50"},
                orq_run_id="orq-50",
            )
        )
        await session.commit()

        reviews = await get_project_reviews(project, session, ServeManager())

    assert seen_offsets == [0, 50]
    assert reviews[0].duration_s == 50.0
    assert reviews[0].cost_usd == 0.5


async def test_rerun_review_relaunches_with_persisted_inputs(db, project: str) -> None:
    executor = NoopExecutor()
    now = datetime.now(tz=UTC)
    async with db() as session:
        session.add(
            RunRow(
                id="rev-done",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                finished_at=now,
                flow="pr_review",
                inputs={"pr_number": "55", "publish": "true"},
            )
        )
        await session.commit()

        new_run = await rerun_review(project, 55, session, executor)

    assert new_run.id != "rev-done"
    assert new_run.flow == "pr_review"
    assert new_run.inputs == {"pr_number": "55", "publish": "true"}
    assert new_run.state == RunState.running
    assert new_run.pid is not None
    executor.finish(new_run.pid)


async def test_rerun_review_queues_when_project_busy(db, project: str) -> None:
    executor = NoopExecutor()
    now = datetime.now(tz=UTC)
    async with db() as session:
        from orquesta_api.services.runs import RunSupervisor

        svc = RunSupervisor(session, executor=executor, session_maker=db)
        active = await svc.launch(project, kind=RunKind.flow, flow="other")

        session.add(
            RunRow(
                id="rev-old",
                project_id=project,
                kind=RunKind.flow.value,
                state=RunState.succeeded.value,
                executor="local",
                created_at=now,
                finished_at=now,
                flow="pr_review",
                inputs={"pr_number": "11"},
            )
        )
        await session.commit()

        new_run = await rerun_review(project, 11, session, executor)

    assert new_run.state == RunState.queued
    assert new_run.flow == "pr_review"
    assert new_run.inputs == {"pr_number": "11"}

    assert active.pid is not None
    executor.finish(active.pid)
    tasks = list(runs_module._SUPERVISOR_TASKS)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


async def test_rerun_review_raises_when_no_prior_run(db, project: str) -> None:
    executor = NoopExecutor()
    async with db() as session:
        with pytest.raises(ValueError, match="not found"):
            await rerun_review(project, 999, session, executor)


async def test_rerun_review_raises_project_not_found_before_pr_lookup(db) -> None:
    executor = NoopExecutor()
    async with db() as session:
        with pytest.raises(ValueError, match="Project 'missing' not found"):
            await rerun_review("missing", 42, session, executor)

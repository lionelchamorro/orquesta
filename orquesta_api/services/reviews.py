"""Review run query and rerun service."""

import asyncio
import re
from collections.abc import Mapping, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orquesta_api.db.tables import ProjectRow, RunRow
from orquesta_api.meta.executor import ExecutorInterface
from orquesta_api.meta.models import ReviewRun, Run, RunKind, RunState
from orquesta_api.services.aggregator import Aggregator
from orquesta_api.services.runs import RunSupervisor

_GITHUB_HTTPS = re.compile(r"^https://github\.com/([^/]+/[^/]+?)(?:\.git)?/?$")
_GITHUB_SSH = re.compile(r"^git@github\.com:([^/]+/[^/]+?)(?:\.git)?$")


def github_pr_url(repo_url: str | None, pr_number: int) -> str | None:
    if not repo_url:
        return None
    m = _GITHUB_HTTPS.match(repo_url) or _GITHUB_SSH.match(repo_url)
    if m is None:
        return None
    return f"https://github.com/{m.group(1)}/pull/{pr_number}"


def _pr_number_from_inputs(inputs: Mapping[str, object] | None) -> int | None:
    raw = (inputs or {}).get("pr_number")
    if not isinstance(raw, str) or not raw.isdigit():
        return None
    return int(raw)


class ReviewService:
    """Read and relaunch persisted pr_review flow runs."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_reviews(self, project_id: str, agg: Aggregator) -> list[ReviewRun]:
        """Return pr_review flow runs for the project, newest-first."""
        project = await self._project(project_id)
        rows = await self._pr_review_rows(project_id)
        async with asyncio.TaskGroup() as tg:
            cost_tasks = [
                tg.create_task(self._orq_cost_duration(agg, project_id, row.orq_run_id))
                for row in rows
            ]

        reviews: list[ReviewRun] = []
        for row, cost_task in zip(rows, cost_tasks, strict=True):
            pr_number = _pr_number_from_inputs(row.inputs)
            pr_url = github_pr_url(project.repo_url, pr_number) if pr_number is not None else None
            duration_s, cost_usd = cost_task.result()
            reviews.append(
                ReviewRun(
                    run_id=row.id,
                    pr_number=pr_number,
                    pr_url=pr_url,
                    state=RunState(row.state),
                    started_at=row.started_at,
                    finished_at=row.finished_at,
                    duration_s=duration_s,
                    cost_usd=cost_usd,
                )
            )
        return reviews

    async def rerun_review(
        self, project_id: str, pr_number: int, executor: ExecutorInterface
    ) -> Run:
        """Relaunch the newest pr_review run for *pr_number* using persisted inputs."""
        await self._project(project_id)
        rows = await self._pr_review_rows(project_id)
        target = next(
            (row for row in rows if (row.inputs or {}).get("pr_number") == str(pr_number)),
            None,
        )
        if target is None:
            raise ValueError(f"pr_review run for PR #{pr_number} not found")
        return await RunSupervisor(self._session, executor=executor).retry(target.id)

    async def _project(self, project_id: str) -> ProjectRow:
        project = await self._session.get(ProjectRow, project_id)
        if project is None:
            raise ValueError(f"Project '{project_id}' not found")
        return project

    async def _pr_review_rows(self, project_id: str) -> Sequence[RunRow]:
        result = await self._session.execute(
            select(RunRow)
            .where(
                RunRow.project_id == project_id,
                RunRow.kind == RunKind.flow.value,
                RunRow.flow == "pr_review",
            )
            .order_by(
                RunRow.started_at.desc().nullslast(),
                RunRow.created_at.desc().nullslast(),
                RunRow.id.desc(),
            )
        )
        return result.scalars().all()

    async def _orq_cost_duration(
        self, agg: Aggregator, project_id: str, orq_run_id: str | None
    ) -> tuple[float | None, float | None]:
        """Return (duration_s, cost_usd) from serve history, or (None, None)."""
        if orq_run_id is None:
            return None, None
        try:
            summary = await agg.get_run(project_id, orq_run_id)
            return summary.duration_s, summary.cost_usd
        except (ValueError, RuntimeError):
            return None, None

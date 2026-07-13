"""Run row conversion helpers."""

from orquesta_api.db.tables import RunRow
from orquesta_api.meta.models import Run, RunHandle, RunKind, RunState


def row_to_model(row: RunRow) -> Run:
    """Convert a RunRow into the public Run model."""
    return Run(
        id=row.id,
        project_id=row.project_id,
        kind=RunKind(row.kind),
        state=RunState(row.state),
        executor=row.executor,
        flow=row.flow,
        inputs=row.inputs or {},
        plan_path=row.plan_path,
        args=row.args or [],
        container_id=row.container_id,
        pid=row.pid,
        api_port=row.api_port,
        started_at=row.started_at,
        finished_at=row.finished_at,
        exit_code=row.exit_code,
        base_sha=row.base_sha,
        head_sha=row.head_sha,
        error=row.error,
        orq_run_id=row.orq_run_id,
    )


def build_handle(row: RunRow) -> RunHandle:
    """Build an executor handle from a RunRow."""
    return RunHandle(
        pid=row.pid, api_port=row.api_port, container_id=row.container_id, run_id=row.id
    )

"""Pydantic mirrors of orq-lite's query API (docs/orq-lite-query-api.md).

Every model is ``extra="allow"`` with lenient defaults: these shapes are a
cross-repo contract that orq-lite may extend, and a new upstream field must
pass through rather than break parsing (same tolerance rule as RunEvent).
"""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from orquesta_api.meta.models import RunEvent


class OrqRunSummary(BaseModel):
    """One row of GET /api/runs — a run recorded in orq-lite's event index."""

    model_config = ConfigDict(extra="allow")

    run_id: str
    command: str = ""
    args: list[str] = Field(default_factory=list)
    status: str = "running"  # running|ok|error|interrupted — str for forward tolerance
    started_at: str = ""
    finished_at: str | None = None
    duration_s: float | None = None
    orq_version: str = ""
    cost_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    agent_runs: int = 0
    tasks_done: int = 0
    tasks_failed: int = 0


class OrqRunsPage(BaseModel):
    model_config = ConfigDict(extra="allow")

    runs: list[OrqRunSummary] = Field(default_factory=list)
    total: int = 0


class OrqRunEventsPage(BaseModel):
    model_config = ConfigDict(extra="allow")

    events: list[RunEvent] = Field(default_factory=list)
    total: int = 0


class AgentRunRecord(BaseModel):
    """One row of GET /api/agent-runs — a single agent invocation."""

    model_config = ConfigDict(extra="allow")

    ts: str = ""
    run_id: str = ""
    role: str = ""
    agent: str = ""
    task_id: str = ""
    cycle: int = 0
    attempt: int = 0
    provider: str = ""
    model: str = ""
    duration_s: float = 0.0
    exit_code: int = 0
    timed_out: bool = False
    rate_limited: bool = False
    input_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    reasoning_tokens: int = 0
    cost_usd: float = 0.0
    artifacts_dir: str = ""


class AgentRunsPage(BaseModel):
    model_config = ConfigDict(extra="allow")

    agent_runs: list[AgentRunRecord] = Field(default_factory=list)
    total: int = 0


class CostRow(BaseModel):
    model_config = ConfigDict(extra="allow")

    key: str = ""
    cost_usd: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    agent_runs: int = 0


class CostStats(BaseModel):
    model_config = ConfigDict(extra="allow")

    by: str = "run"
    rows: list[CostRow] = Field(default_factory=list)


class FlowCatalogInput(BaseModel):
    model_config = ConfigDict(extra="allow")

    type: str = "string"
    default: Any | None = None
    required: bool = False


class FlowCatalogEntry(BaseModel):
    """One flow from GET /api/flows: inputs schema + per-role preflight."""

    model_config = ConfigDict(extra="allow")

    name: str
    description: str = ""
    inputs: dict[str, FlowCatalogInput] = Field(default_factory=dict)
    roles: list[str] = Field(default_factory=list)
    preflight: dict[str, str] = Field(default_factory=dict)


class FlowCatalog(BaseModel):
    model_config = ConfigDict(extra="allow")

    flows: list[FlowCatalogEntry] = Field(default_factory=list)


class DoctorCheck(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str = ""
    status: str = "ok"  # ok|warn|error — str for forward tolerance
    detail: str = ""


class DoctorReport(BaseModel):
    model_config = ConfigDict(extra="allow")

    ok: bool = True
    checks: list[DoctorCheck] = Field(default_factory=list)


class AttemptDiff(BaseModel):
    """GET /api/attempt-diff/{task}/{role}/{cycle}/{attempt} (exists since v0.2.0)."""

    model_config = ConfigDict(extra="allow")

    available: bool = False
    task: str = ""
    role: str = ""
    cycle: int = 0
    attempt: int = 0
    artifacts_dir: str = ""
    diff: str = ""

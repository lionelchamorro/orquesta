"""Pydantic domain models mirroring the TypeScript types in lib/types.ts."""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class TaskStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    done = "done"
    failed = "failed"
    needs_human = "needs_human"
    decomposed = "decomposed"
    needs_clarification = "needs_clarification"


class VerifyState(str, Enum):
    empty = ""
    pending = "pending"
    tests_pass = "tests_pass"  # noqa: S105
    tests_fail = "tests_fail"
    tests_skipped = "tests_skipped"
    pass_ = "pass"  # noqa: S105
    error = "error"
    commit_ok = "commit_ok"
    commit_rejected = "commit_rejected"
    commit_skipped = "commit_skipped"
    commit_empty = "commit_empty"


class AgentRole(str, Enum):
    planner = "planner"
    parser = "parser"
    coder = "coder"
    tester = "tester"
    critic = "critic"
    reviewer = "reviewer"
    verifier = "verifier"
    compactor = "compactor"
    generalist = "generalist"
    intake = "intake"


class FeatureStatus(str, Enum):
    pending = "pending"
    in_progress = "in_progress"
    done = "done"
    failed = "failed"
    needs_human = "needs_human"


class EventKind(str, Enum):
    agent_run = "agent_run"
    task_start = "task_start"
    task_done = "task_done"
    task_failed = "task_failed"
    cycle_start = "cycle_start"
    cycle_end = "cycle_end"
    tester_verification_failed = "tester_verification_failed"
    full_suite_failed = "full_suite_failed"


class RunState(str, Enum):
    queued = "queued"
    starting = "starting"
    running = "running"
    stopping = "stopping"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class RunKind(str, Enum):
    run = "run"
    factory = "factory"
    plan = "plan"
    flow = "flow"


class ContainerState(str, Enum):
    created = "created"
    running = "running"
    paused = "paused"
    exited = "exited"
    dead = "dead"


class ProjectState(str, Enum):
    running = "running"
    idle = "idle"
    needs_human = "needs_human"
    paused = "paused"


class Task(BaseModel):
    id: str
    status: TaskStatus
    verify_state: VerifyState = VerifyState.empty
    attempts: int
    last_agent: str = ""
    title: str
    failure_reason: str | None = None


class Feature(BaseModel):
    id: str
    status: FeatureStatus
    branch: str = ""
    tasks_done: int = 0
    tasks_failed: int = 0
    cost_usd: float = 0.0
    title: str
    pr_url: str | None = None


class RunEvent(BaseModel):
    ts: str
    event: EventKind
    role: AgentRole | None = None
    agent: str | None = None
    status: str | None = None
    task_id: str | None = None
    duration_s: float | None = None
    reason: str | None = None
    cycle: int | None = None
    new_tasks_proposed: int | None = None
    command: str | None = None
    commit_sha: str | None = None
    project: str | None = None


class ProjectWatch(BaseModel):
    prs: bool
    issues: bool


class Project(BaseModel):
    id: str
    name: str
    repo_url: str
    workspace_path: str
    base_branch: str
    watch: ProjectWatch
    state: ProjectState
    description: str
    language: str
    tasks: list[Task] = Field(default_factory=list)
    features: list[Feature] = Field(default_factory=list)
    events: list[RunEvent] = Field(default_factory=list)
    cost_usd: float
    last_run: str
    source: Literal["mock", "orq-lite"] | None = None


class ChatMessage(BaseModel):
    id: str
    role: Literal["user", "assistant"]
    content: str
    project: str | None = None
    action: str | None = None


class Repo(BaseModel):
    project_id: str
    root: str
    remote_url: str | None = None
    base_branch: str
    head_sha: str | None = None
    current_branch: str | None = None
    dirty: bool
    managed: bool


class Run(BaseModel):
    id: str
    project_id: str
    kind: RunKind
    state: RunState
    executor: str
    container_id: str | None = None
    pid: int | None = None
    api_port: int | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    exit_code: int | None = None
    base_sha: str | None = None
    head_sha: str | None = None
    error: str | None = None


class RunSpec(BaseModel):
    project_id: str
    workspace_path: str
    kind: RunKind
    plan_path: str | None = None
    flow: str | None = None
    inputs: dict[str, str] = Field(default_factory=dict)
    args: list[str] = Field(default_factory=list)


class RunHandle(BaseModel):
    container_id: str | None = None
    pid: int | None = None
    api_port: int | None = None
    run_id: str | None = None


class Container(BaseModel):
    id: str
    run_id: str | None = None
    project_id: str | None = None
    image: str
    state: ContainerState
    health: str | None = None
    created_at: datetime
    ports: dict[str, int | None] = Field(default_factory=dict)
    name: str


class AgentDefinition(BaseModel):
    id: str
    provider: str
    model: str | None = None
    effort: str | None = None
    cmd: list[str] | None = None
    dangerously_skip_permissions: bool | None = None
    rate_limit_pattern: str | None = None


class TeamRoleDefinition(BaseModel):
    role: str
    agents: list[str] = Field(default_factory=list)
    prompt: str
    result_path: str
    timeout_seconds: int
    escalation_ladder: list[str] | None = None
    decompose_prompt: str | None = None
    mode: Literal["per_task", "per_cycle", "both", ""] | None = None
    cycle_prompt: str | None = None


class TeamLimits(BaseModel):
    max_review_cycles: int | None = None
    max_fix_iterations: int | None = None
    verify_tester_command: bool | None = None
    factory_budget_usd: float | None = None
    max_visual_rounds: int | None = None
    resume_sessions: bool | None = None
    memory_compact_chars: int | None = None
    max_feature_retries: int | None = None


class TeamDefinition(BaseModel):
    id: str = "default"
    name: str = "Default delivery team"
    description: str = "orq-lite team.json roster"
    agents: list[AgentDefinition] = Field(default_factory=list)
    roles: list[TeamRoleDefinition] = Field(default_factory=list)
    limits: TeamLimits = Field(default_factory=TeamLimits)
    full_test_command: str = ""
    lint_command: str | None = ""
    conventions_file: str | None = None
    source: Literal["mock", "orq-lite", "orquesta-api"] | None = "orquesta-api"


class FlowStep(BaseModel):
    id: str
    label: str
    command: str = "orq-lite"
    args: list[str] = Field(default_factory=list)
    role: str | None = None
    depends_on: list[str] = Field(default_factory=list)
    description: str | None = None


class FlowDefinition(BaseModel):
    id: str
    name: str
    description: str = "Configured orq-lite flow"
    team_id: str = "default"
    entrypoint: str = ""
    variables: dict[str, str] = Field(default_factory=dict)
    steps: list[FlowStep] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    source: Literal["mock", "orq-lite", "orquesta-api"] | None = "orquesta-api"

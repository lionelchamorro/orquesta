"""Task 9/10: query-API proxies against a fake orq-lite serve.

The fake serve implements the contract in docs/orq-lite-query-api.md via
httpx.MockTransport — the real endpoints don't exist until orq-lite ships
its query-API feature, so this is a contract test on our side of the wire.
"""

import httpx
import pytest

from orquesta_api.core.integrations.orq_lite_client import OrqLiteClient
from orquesta_api.services.aggregator import Aggregator
from orquesta_api.services.serves import ServeManager

RUN_SUMMARY = {
    "run_id": "r-2026-07-02-abc",
    "command": "flow",
    "args": ["run", "pr_review"],
    "status": "ok",
    "started_at": "2026-07-02T10:00:00Z",
    "finished_at": "2026-07-02T10:05:00Z",
    "duration_s": 300.0,
    "orq_version": "v0.3.0",
    "cost_usd": 1.25,
    "input_tokens": 10000,
    "output_tokens": 4000,
    "agent_runs": 6,
    "tasks_done": 3,
    "tasks_failed": 0,
    "future_field": "must pass through",
}

AGENT_RUN = {
    "ts": "2026-07-02T10:01:00Z",
    "run_id": "r-2026-07-02-abc",
    "role": "coder",
    "agent": "codex_gpt5",
    "task_id": "T-001",
    "cycle": 1,
    "attempt": 1,
    "provider": "codex",
    "model": "gpt-5.5",
    "duration_s": 42.0,
    "exit_code": 0,
    "timed_out": False,
    "rate_limited": False,
    "input_tokens": 5000,
    "output_tokens": 2000,
    "cached_input_tokens": 100,
    "reasoning_tokens": 0,
    "cost_usd": 0.5,
    "artifacts_dir": ".orquestalite/runs/r-2026-07-02-abc/agents/coder-1-1",
}

FLOW_CATALOG = {
    "flows": [
        {
            "name": "pr_review",
            "description": "Review a PR.",
            "inputs": {
                "pr_number": {"type": "string", "default": None, "required": True},
                "base_branch": {"type": "string", "default": "main", "required": False},
            },
            "roles": ["critic", "review_lead"],
            "preflight": {"critic": "ok", "review_lead": "missing_prompt"},
        }
    ]
}

DOCTOR = {
    "ok": False,
    "checks": [
        {"name": "team.json", "status": "ok", "detail": "valid"},
        {"name": "binary:gh", "status": "error", "detail": "gh not found on PATH"},
    ],
}


def _runs_response(request: httpx.Request) -> dict:
    if request.url.params.get("active") == "true":
        return {"runs": [], "total": 0}
    return {"runs": [RUN_SUMMARY], "total": 1}


def _events_response(request: httpx.Request) -> dict:
    assert request.url.params.get("limit") == "200"
    return {"events": [{"ts": "2026-07-02T10:00:00Z", "event": "run_start"}], "total": 1}


def _agent_runs_response(request: httpx.Request) -> dict:
    assert request.url.params.get("run_id") == "r-2026-07-02-abc"
    return {"agent_runs": [AGENT_RUN], "total": 1}


def _cost_response(request: httpx.Request) -> dict:
    return {
        "by": request.url.params.get("by", "run"),
        "rows": [
            {
                "key": "codex_gpt5",
                "cost_usd": 0.5,
                "input_tokens": 5000,
                "output_tokens": 2000,
                "agent_runs": 1,
            }
        ],
    }


_ROUTES = {
    "/api/runs": _runs_response,
    "/api/runs/r-2026-07-02-abc": lambda _req: RUN_SUMMARY,
    "/api/runs/r-2026-07-02-abc/events": _events_response,
    "/api/agent-runs": _agent_runs_response,
    "/api/stats/cost": _cost_response,
    "/api/flows": lambda _req: FLOW_CATALOG,
    "/api/doctor": lambda _req: DOCTOR,
}


def _fake_serve() -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path.startswith("/api/attempt-diff/"):
            return httpx.Response(
                200, json={"available": True, "task": "T-001", "diff": "+ added line"}
            )
        route = _ROUTES.get(path)
        if route is None:
            return httpx.Response(404, json={"error": f"unknown path {path}"})
        return httpx.Response(200, json=route(request))

    return httpx.MockTransport(handler)


class _FakeAliveProcess:
    returncode: int | None = None


@pytest.fixture
def agg() -> Aggregator:
    sm = ServeManager()
    sm._ports["proj"] = 9999
    sm._processes["proj"] = _FakeAliveProcess()
    return Aggregator(serves=sm, client=OrqLiteClient(transport=_fake_serve()))


async def test_list_runs_parses_and_passes_unknown_fields_through(agg: Aggregator) -> None:
    page = await agg.list_runs("proj")
    assert page.total == 1
    run = page.runs[0]
    assert run.run_id == "r-2026-07-02-abc"
    assert run.status == "ok"
    assert run.cost_usd == 1.25
    assert run.model_dump()["future_field"] == "must pass through"


async def test_list_runs_active_filter_is_forwarded(agg: Aggregator) -> None:
    page = await agg.list_runs("proj", active=True)
    assert page.total == 0


async def test_get_run_and_events(agg: Aggregator) -> None:
    run = await agg.get_run("proj", "r-2026-07-02-abc")
    assert run.tasks_done == 3

    events = await agg.get_run_events("proj", "r-2026-07-02-abc")
    assert events.total == 1
    assert events.events[0].event.value == "run_start"


async def test_agent_runs_filters_and_parsing(agg: Aggregator) -> None:
    page = await agg.get_agent_runs("proj", run_id="r-2026-07-02-abc")
    record = page.agent_runs[0]
    assert record.role == "coder"
    assert record.input_tokens == 5000
    assert record.artifacts_dir.endswith("coder-1-1")


async def test_cost_stats_by_agent(agg: Aggregator) -> None:
    stats = await agg.get_cost_stats("proj", by="agent")
    assert stats.by == "agent"
    assert stats.rows[0].key == "codex_gpt5"


async def test_flow_catalog_inputs_and_preflight(agg: Aggregator) -> None:
    catalog = await agg.get_flow_catalog("proj")
    flow = catalog.flows[0]
    assert flow.name == "pr_review"
    assert flow.inputs["pr_number"].required is True
    assert flow.inputs["base_branch"].default == "main"
    assert flow.preflight["review_lead"] == "missing_prompt"


async def test_doctor_report(agg: Aggregator) -> None:
    report = await agg.get_doctor("proj")
    assert report.ok is False
    assert report.checks[1].status == "error"


async def test_attempt_diff_passthrough(agg: Aggregator) -> None:
    diff = await agg.get_attempt_diff("proj", "T-001", "coder", 1, 1)
    assert diff.available is True
    assert "+ added line" in diff.diff


async def test_no_serve_raises_not_found() -> None:
    agg = Aggregator(serves=ServeManager(), client=OrqLiteClient(transport=_fake_serve()))
    with pytest.raises(ValueError, match="not found"):
        await agg.list_runs("proj")


async def test_old_orq_lite_without_query_api_maps_to_runtime_error() -> None:
    """A serve predating the query API 404s -> RuntimeError (-> 502), not a crash."""

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, text="404 page not found")

    sm = ServeManager()
    sm._ports["proj"] = 9999
    sm._processes["proj"] = _FakeAliveProcess()
    agg = Aggregator(serves=sm, client=OrqLiteClient(transport=httpx.MockTransport(handler)))
    with pytest.raises(RuntimeError, match="404"):
        await agg.list_runs("proj")

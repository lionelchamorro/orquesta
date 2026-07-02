# orq-lite query API contract (consumed by Tasks 9–10)

orquesta's run-history screens and schema-driven flow launcher are built
against the endpoints below, which orq-lite ships per its `features.md`
(query API + `/api/flows` + `/api/doctor`). As of orq-lite v0.2.0 these do
NOT exist yet — every orquesta feature consuming them degrades gracefully
(history tab shows an upgrade notice; the launcher falls back to the static
flow selector). This file is the single place the expected shapes live on
the orquesta side; the authoritative copy is orq-lite's `docs/query-api.md`
once it lands. If a field changes, change it in both repos.

All endpoints are `GET` on the per-project `orq-lite serve` (loopback), all
return JSON with `Cache-Control: no-store`.

## Run history

- `GET /api/runs?limit=&offset=&active=true|false` →
  `{"runs": [RunSummary...], "total": int}`, newest-first.
  `active=true` → only `status == "running"` (proposal I5 — used by the
  control plane to correlate its own launch records with `run_id`).
- `GET /api/runs/{id}` → `RunSummary` | 404 `{"error": ...}`.
- `GET /api/runs/{id}/events?type=&task_id=&limit=&offset=` →
  `{"events": [<raw run.log event>...], "total": int}`, log order.
- `GET /api/agent-runs?run_id=&task_id=&role=&agent=&limit=&offset=` →
  `{"agent_runs": [AgentRunRecord...], "total": int}`, newest-first.
- `GET /api/stats/cost?by=run|agent|task|role` →
  `{"by": <echo>, "rows": [{"key", "cost_usd", "input_tokens",
  "output_tokens", "agent_runs"}...]}`, cost descending.

```
RunSummary = {
  run_id: str, command: str, args: [str],
  status: "running"|"ok"|"error"|"interrupted",
  started_at: RFC3339, finished_at: RFC3339|null, duration_s: float|null,
  orq_version: str, cost_usd: float, input_tokens: int, output_tokens: int,
  agent_runs: int, tasks_done: int, tasks_failed: int
}
AgentRunRecord = {
  ts: RFC3339, run_id: str, role: str, agent: str, task_id: str,
  cycle: int, attempt: int, provider: str, model: str, duration_s: float,
  exit_code: int, timed_out: bool, rate_limited: bool,
  input_tokens: int, output_tokens: int, cached_input_tokens: int,
  reasoning_tokens: int, cost_usd: float, artifacts_dir: str
}
```

## Flow catalog (proposal I1)

- `GET /api/flows` → `{"flows": [{name, description,
  inputs: {<name>: {type, default, required}}, roles: [str],
  preflight: {<role>: "ok"|"missing_role"|"missing_prompt"}}...]}`

## Doctor (proposal I2)

- `GET /api/doctor` → `{"ok": bool, "checks": [{name,
  status: "ok"|"warn"|"error", detail}...]}`

## orquesta-side mirrors

Pydantic: `orquesta_api/meta/query_models.py` (all `extra="allow"` with
lenient defaults — the upstream may grow fields). TypeScript:
`lib/types.ts` (`OrqRunSummary`, `AgentRunRecord`, `CostRow`,
`FlowCatalogInput`, `FlowCatalogEntry`, `DoctorCheck`). Field-name parity
is enforced by `test/test_contract_types.py`.

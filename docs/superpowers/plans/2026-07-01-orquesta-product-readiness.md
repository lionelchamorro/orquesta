# orquesta Product Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dejar orquesta operable como control plane real: runs que se lanzan y finalizan de verdad (incluidos flows dinámicos), un serve de orq-lite persistente por proyecto, editores de config que no corrompen `team.json`/`flows.json`, eventos vivos multi-proyecto, historia/costo sobre la query API de orq-lite, chat centralizado con acciones reales, y auth+watchers+docker para producción.

**Architecture:** El backend FastAPI supervisa procesos `orq-lite` (CLI, cwd=workspace) para toda escritura y lee estado por HTTP de un `orq-lite serve` read-only persistente por proyecto (decisión D1 del assessment). El frontend Next.js consume todo vía el proxy `/api/control-plane/*`. La historia entre corridas viene de la query API de orq-lite (Task 11b de su plan), no se duplica en la DB de orquesta.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 async + Pydantic v2 (uv), Next.js 16 App Router + React 19 + Tailwind, httpx, orq-lite ≥ el estado del plan 2026-07-01.

**Assessment de referencia:** `docs/superpowers/specs/2026-07-01-orquesta-product-readiness-assessment.md`

## Global Constraints

- El serve de orq-lite es **read-only**; toda mutación de un proyecto pasa por spawn del CLI con `cwd=<workspace>` (nunca escribir `.orquestalite/` desde Python).
- Round-trip de config sin pérdida: al editar `team.json`/`flows.json` se hace read-modify-write del JSON crudo; campos desconocidos se preservan siempre (incluido `rate_limit_backoff`).
- Los modelos Pydantic espejan `lib/types.ts` campo por campo; todo cambio de shape toca ambos en la misma tarea.
- Excepciones de dominio → handlers ya registrados en `main.py` (ValueError→404/400, FileExistsError→409, RuntimeError→502, PermissionError→401, NotImplementedError→501).
- Cada tarea termina con `uv run ruff check && uv run ruff format --check && uv run pytest` en verde (y `pnpm exec tsc --noEmit` cuando toca frontend) y un commit.
- Convención de commits: `feat(pkg): ...` / `fix(pkg): ...` / `docs: ...`.
- Ninguna dependencia Python nueva salvo las aprobadas aquí: `alembic` (Task 17). Docker SDK (`docker`) recién en Fase 6.

> **Nota de alcance:** las Fases 0–1 están especificadas a nivel de código; las Fases 2–7 a nivel de contrato + snippets de las piezas críticas, y cada una merece su propio pase de `writing-plans` al ejecutarla. La sección final lista las tareas propuestas **en el repo orquesta-lite** (I1–I5) de las que dependen las Fases 2–3.

---

## Fase 0 — Runs reales (P0)

### Task 1: Test harness + argv correcto por kind (incluido `flow`) + cwd

Hoy `LocalExecutor.start` construye `[bin, --addr, port, *args]` sin cwd (`executors/local.py:30-44`): argv inválido (el CLI exige subcomando primero) y corre en el cwd del API. Se corrige con un builder puro y testeable, y se agrega `RunKind.flow`.

**Files:**
- Create: `test/conftest.py`, `test/test_argv.py`, `test/test_local_executor.py`, `test/fake_orq_lite.py`
- Modify: `orquesta_api/meta/models.py` (RunKind + RunSpec), `orquesta_api/executors/local.py`, `orquesta_api/services/runs.py`, `orquesta_api/routers/runs.py` (RunCreate), `lib/types.ts` (RunKind espejo)

**Interfaces:**
- Produces: `build_argv(bin: str, spec: RunSpec) -> list[str]` en `executors/local.py`; `RunKind.flow`; `RunSpec.flow: str | None`, `RunSpec.inputs: dict[str, str]`; `RunCreate` acepta `{kind, flow?, inputs?, plan_path?, args?}`.

- [ ] **Step 1: Fixture de DB y stub binario** — `test/conftest.py` con engine SQLite in-memory + sesión, y `test/fake_orq_lite.py`: script Python que registra argv/cwd en un JSON y duerme/exita según env (`FAKE_EXIT_CODE`, `FAKE_SLEEP_S`). Fixture `fake_bin(tmp_path)` lo copia como ejecutable `orq-lite`.

```python
# test/conftest.py
import asyncio
import shutil
import stat
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from orquesta_api.db.tables import Base

FAKE = Path(__file__).parent / "fake_orq_lite.py"


@pytest.fixture
async def session():
    engine = create_async_engine("sqlite+aiosqlite://")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as s:
        yield s
    await engine.dispose()


@pytest.fixture
def fake_bin(tmp_path: Path) -> str:
    dst = tmp_path / "orq-lite"
    dst.write_text(f"#!/usr/bin/env python3\n{FAKE.read_text()}")
    dst.chmod(dst.stat().st_mode | stat.S_IEXEC)
    return str(dst)
```

```python
# test/fake_orq_lite.py — cuerpo inyectado al stub; registra la invocación y simula un run
import json
import os
import sys
import time
from pathlib import Path

Path(os.environ.get("FAKE_LOG", "invocation.json")).write_text(
    json.dumps({"argv": sys.argv[1:], "cwd": os.getcwd()})
)
time.sleep(float(os.environ.get("FAKE_SLEEP_S", "0")))
print("fake orq-lite done")
sys.exit(int(os.environ.get("FAKE_EXIT_CODE", "0")))
```

- [ ] **Step 2: Test de argv que falla** — tabla por kind:

```python
# test/test_argv.py
import pytest

from orquesta_api.executors.local import build_argv
from orquesta_api.meta.models import RunKind, RunSpec


def spec(**kw) -> RunSpec:
    base = {"project_id": "p", "workspace_path": "/ws", "kind": RunKind.run}
    return RunSpec(**{**base, **kw})


@pytest.mark.parametrize(
    ("s", "expected"),
    [
        (spec(kind=RunKind.run), ["orq-lite", "run"]),
        (spec(kind=RunKind.factory), ["orq-lite", "factory", "--serve=false"]),
        (
            spec(kind=RunKind.factory, plan_path="features.md"),
            ["orq-lite", "factory", "--serve=false", "features.md"],
        ),
        (spec(kind=RunKind.plan, plan_path="plan.md"), ["orq-lite", "plan", "plan.md"]),
        (
            spec(kind=RunKind.flow, flow="pr_review", inputs={"pr_number": "42", "publish": "true"}),
            ["orq-lite", "flow", "run", "pr_review", "pr_number=42", "publish=true"],
        ),
    ],
)
def test_build_argv(s: RunSpec, expected: list[str]) -> None:
    assert build_argv("orq-lite", s) == expected


def test_flow_requires_name() -> None:
    with pytest.raises(ValueError, match="flow"):
        build_argv("orq-lite", spec(kind=RunKind.flow))


def test_plan_requires_path() -> None:
    with pytest.raises(ValueError, match="plan_path"):
        build_argv("orq-lite", spec(kind=RunKind.plan))
```

- [ ] **Step 3: Correr y ver fallar** — `uv run pytest test/test_argv.py -v` → FAIL (`build_argv` no existe; `RunKind.flow` no existe).
- [ ] **Step 4: Modelos** — en `meta/models.py`: `RunKind.flow = "flow"`; `RunSpec` gana `flow: str | None = None` e `inputs: dict[str, str] = Field(default_factory=dict)`; quitar `serve: bool` (decisión D1: los runs son headless, el dashboard lo da el serve por proyecto de Task 2). Espejo en `lib/types.ts`: `export type RunKind = "run" | "factory" | "plan" | "flow"`.
- [ ] **Step 5: Implementar `build_argv`** en `executors/local.py`:

```python
def build_argv(bin_path: str, spec: RunSpec) -> list[str]:
    """Map a RunSpec to the exact orq-lite CLI invocation (subcommand first)."""
    match spec.kind:
        case RunKind.run:
            argv = [bin_path, "run"]
        case RunKind.factory:
            # The per-project serve (Task 2) owns the dashboard; keep runs headless.
            argv = [bin_path, "factory", "--serve=false"]
            if spec.plan_path:
                argv.append(spec.plan_path)
        case RunKind.plan:
            if not spec.plan_path:
                raise ValueError("plan runs require plan_path")
            argv = [bin_path, "plan", spec.plan_path]
        case RunKind.flow:
            if not spec.flow:
                raise ValueError("flow runs require a flow name")
            argv = [bin_path, "flow", "run", spec.flow]
            argv.extend(f"{k}={v}" for k, v in spec.inputs.items())
    return [*argv, *spec.args]
```

- [ ] **Step 6: `start` usa el builder + cwd** — en `LocalExecutor.start`: `cmd = build_argv(self._bin, spec)`; `create_subprocess_exec(*cmd, cwd=spec.workspace_path, ...)`; eliminar `_find_free_port`/`--addr` (el puerto ya no es del run). Test de integración en `test/test_local_executor.py`: lanzar con `fake_bin`, assert de que `invocation.json` aparece **dentro del workspace tmp** con el argv esperado; `status()` pasa de `running` a `succeeded` tras `process.wait()`.
- [ ] **Step 7: Router/servicio** — `RunCreate` gana `flow: str | None` e `inputs: dict[str, str]`; `RunSupervisor.launch` los threadea al `RunSpec` y **rechaza el launch con `FileExistsError` (→409) si ya hay un run activo del proyecto** (mismo predicado `_ACTIVE_RUN_STATES` de `services/repos.py:15`). Test: segundo launch concurrente → 409.
- [ ] **Step 8: Preparación del workspace antes del launch** — un clone fresco no tiene `team.json`/`flows.json`/`prompts/` y todo run moriría en `config.Load`. `RunSupervisor.launch` (antes de `executor.start`) llama `ensure_workspace_ready(workspace)`: si falta `team.json`, corre `orq-lite init` (subprocess, cwd=workspace, mismo binario de settings) y falla el launch con `RuntimeError` (→502) si `init` sale ≠0. No sobreescribe config existente (`init` ya es no-destructivo). Test: workspace git sin config → launch dispara `init` primero (el stub registra ambas invocaciones en orden); workspace con `team.json` → no se invoca `init`.
- [ ] **Step 9: Verde + commit** — `uv run pytest -v` → PASS. `feat(runs): correct per-kind orq-lite argv, workspace cwd/init and flow kind`

### Task 1b: Modelos espejo tolerantes al JSON real de orq-lite

El Aggregator hoy explota con el primer snapshot real: `Task(**t)`/`Feature(**f)` (`services/aggregator.py:56-57`) usan modelos con requeridos que orq-lite **omite** por `omitempty`, y enums más chicos que los valores reales.

**Files:**
- Modify: `orquesta_api/meta/models.py`, `lib/types.ts` (espejo)
- Test: `test/test_mirror_models.py`

**Interfaces (contra los structs de Go — fuente de verdad):**
- `Task.verify_state: VerifyState = VerifyState.empty` (Go: `verify_state,omitempty`, `tasks.go:106`).
- `Task.last_agent: str = ""` — es el **nombre del agente**, no un rol (`tasks.go:110-113`); eliminar el tipo `AgentRole | Literal[""]`. En `lib/types.ts`, `last_agent: string`.
- `Feature.cost_usd: float = 0.0` (Go: `cost_usd,omitempty`, `factory.go:49`).
- `Feature.tasks_done/tasks_failed: int = 0` y `branch: str = ""` (defaults defensivos: una feature `pending` recién encolada puede no traerlos).
- `AgentRole` (usado por `_VALID_ROLES` y el front) se amplía a los 9 reales: `planner|parser|coder|tester|critic|reviewer|verifier|compactor|generalist` (+ `intake`), alineado con `lib/types.ts:25-34` que ya los tiene — el drift es solo del lado Python.
- `TaskStatus`/`FeatureStatus` ya cubren los valores reales (`decomposed`/`needs_clarification` presentes en `models.py:10-18`; factory solo emite `pending|in_progress|done|failed`, `factory.go:21-26`) — sin cambios, se agrega test de regresión.

- [ ] **Step 1: Test con fixtures reales** — `tasks.json`/`factory.json` mínimos generados por orq-lite (task recién parseada sin `verify_state`/`last_agent`; feature `pending` sin `cost_usd`) → `Task(**t)` y `Feature(**f)` validan sin error.
- [ ] **Step 2: Implementar + espejo TS + commit** — `fix(models): tolerate omitempty fields and real role/agent values from orq-lite`

### Task 2: `orq-lite serve` persistente por proyecto (decisión D1)

**Files:**
- Create: `orquesta_api/services/serves.py`, `test/test_serve_manager.py`
- Modify: `orquesta_api/db/tables.py` (columna `serve_port` en `ProjectRow`), `orquesta_api/services/aggregator.py` (base_url por proyecto), `orquesta_api/main.py` (lifespan: arrancar/parar serves), `orquesta_api/services/projects.py` (alta/baja registran el serve)

**Interfaces:**
- Produces: `ServeManager` singleton (inyectado por lifespan en `app.state.serves`):

```python
class ServeManager:
    async def ensure(self, project_id: str, workspace: str) -> int: ...  # devuelve puerto; idempotente
    async def stop(self, project_id: str) -> None: ...
    async def start_all(self, session: AsyncSession) -> None: ...       # startup: un serve por proyecto registrado
    async def shutdown(self) -> None: ...
    def port(self, project_id: str) -> int | None: ...
```

- Semántica: spawn `orq-lite serve --addr 127.0.0.1:<puerto-libre>` con `cwd=workspace`; health-check `GET /api/tasks` con reintentos (5×200ms) antes de devolver; si el proceso muere, el siguiente `ensure` lo relanza (nuevo puerto); `serve_port` persistido es informativo, la fuente es el manager.
- `Aggregator._base_url` pasa a resolver el puerto vía `ServeManager.port(project_id)` (inyectado), no vía `RunRow.api_port` → **snapshot funciona sin run activo** y desaparece el 500 de `MultipleResultsFound` (`services/aggregator.py:83-90`).

- [ ] **Step 1: Test** — con `fake_bin` como serve (el stub duerme; para health-check, fixture que levanta un `aiohttp`/`http.server` trivial no hace falta: inyectar `health_check=lambda port: True` como colaborador del manager para unit tests, y un test de integración marcado `@pytest.mark.orqlite` que usa el binario real si está en PATH).
- [ ] **Step 2: Implementar** `ServeManager` (procesos en dict, lock por proyecto, `_find_free_port` movido acá desde local.py).
- [ ] **Step 3: Lifespan** — en `_lifespan`: `start_all` tras `create_all`; `shutdown` en el teardown. `ProjectService.create` llama `ensure` tras el clone/adopt; `delete` llama `stop`.
- [ ] **Step 4: Aggregator** — inyección del manager; tests de snapshot con serve fake (httpx `MockTransport` o servidor `httptest`-style con `uvicorn` no: usar `httpx.MockTransport` en `OrqLiteClient` — requiere Task 18 Step del cliente compartido; para esta task, pasar `OrqLiteClient(transport=...)`).
- [ ] **Step 5: Commit** — `feat(serve): persistent read-only orq-lite serve per project`

### Task 3: Supervisión, finalización y reconciliación de runs

**Files:**
- Modify: `orquesta_api/services/runs.py`, `orquesta_api/executors/local.py`, `orquesta_api/main.py` (reconciliación en lifespan), `orquesta_api/db/tables.py` (`ProjectRow.state/last_run` ya existen — se actualizan acá)
- Test: `test/test_run_lifecycle.py`

**Interfaces:**
- Produces: al lanzar, `RunSupervisor` registra una task asyncio `_supervise(run_id, pid)` que hace `await process.wait()` y finaliza: `exit_code` real, `finished_at`, `state = succeeded|failed` (0/≠0), `project.state = idle|needs_human`, `project.last_run = now`. Usa su **propia** sesión (`async_sessionmaker`), nunca la del request.
- `stop()` deja de hardcodear `exit_code=1` (`services/runs.py:124-131`): espera la finalización del supervisor y devuelve el estado real (`cancelled` solo si el stop mató al proceso).
- Reconciliación en startup: todo `RunRow` en estado activo sin proceso conocido → `state=failed`, `error="orphaned by control-plane restart"` (los pids no sobreviven al restart del API; documentado como limitación del LocalExecutor).
- Logs: `_log_cache` acotado a un deque de 5000 líneas **y** espejado a `workspaces_dir/../run-logs/<run_id>.log` en disco para que `GET /runs/{id}/logs?tail=` funcione tras un restart.

- [ ] **Step 1: Test happy path** — launch con `fake_bin` (`FAKE_EXIT_CODE=0`, sleep corto) → poll hasta `state=succeeded`, `exit_code=0`, `finished_at` seteado, `project.state == "idle"`.
- [ ] **Step 2: Test failure** — `FAKE_EXIT_CODE=3` → `state=failed`, `project.state == "needs_human"`.
- [ ] **Step 3: Test reconciliación** — sembrar `RunRow(state="running")` en DB, instanciar el supervisor fresco, correr `reconcile()` → `failed` + error de orphaned.
- [ ] **Step 4: Implementar + commit** — `feat(runs): supervised lifecycle with real finalization and startup reconciliation`

### Task 4: Frontend — mutaciones reales y fin de los mocks en vivo

**Files:**
- Modify: `components/console/registry-table.tsx`, `components/console/project-view.tsx` (`ProjectActions`), `components/console/live-events.tsx`, `orquesta_api/routers/projects.py` + `orquesta_api/services/projects.py` (PATCH con watch granular), `lib/types.ts` (payloads)
- Test: `test/test_projects_patch.py`

**Interfaces:**
- `ProjectPatch` pasa a `watch: ProjectWatch | None` (`{prs, issues}` separados — hoy un solo bool colapsa ambos, `routers/projects.py:53` / `services/projects.py:115-117`).
- `registry-table.tsx`: `addProject` → `POST /api/control-plane/projects` (con `router.refresh()` de `next/navigation` en éxito; error del backend mostrado en el form); `toggleWatch` → `PATCH /api/control-plane/projects/{id}` optimista con rollback en error.
- `ProjectActions`: botón "Run flow" que abre un `<select>` de kinds (`factory` legacy + flows por defecto `factory_fast_governed|pr_review|issue_fix` hasta que exista I1) y hace `POST /api/control-plane/projects/{id}/runs` con `{kind:"flow", flow, inputs}`; deshabilitado con run activo (409 manejado).
- `live-events.tsx`: **eliminar el generador de eventos mock** (`live-events.tsx:109-118`) y el import de `liveEventFor`. La conexión per-proyecto llega en Fase 2; mientras tanto el stream global existente queda detrás de `if (source !== "mock")`.

- [ ] **Step 1: Test backend PATCH** — `{watch: {prs: true, issues: false}}` persiste ambos flags de forma independiente.
- [ ] **Step 2: Implementar backend + tipos + componentes** (los tres handlers `fetch` con manejo de `!res.ok` → `detail`).
- [ ] **Step 3: Verificación manual** — `uv run uvicorn 'orquesta_api.main:create_app' --factory --port 8000` + `ORQUESTA_API_URL=http://127.0.0.1:8000 pnpm dev`: alta de proyecto real (repo de juguete), toggle persiste tras reload, lanzar `factory` y ver el run en `GET /runs`.
- [ ] **Step 4: Commit** — `feat(console): wire registry, watch toggles and run launcher to the control plane`

---

## Fase 1 — Config per-proyecto sin pérdida

### Task 5: Stores per-proyecto con round-trip crudo

El bug bloqueante: `TeamConfigStore._dump_team` (`services/config_files.py:177-193`) omite `rate_limit_backoff`, que `config.Validate()` de orq-lite exige (`orquesta-lite/internal/config/config.go:326`) → guardar desde la UI deja el proyecto **inarrancable**. Y ambos stores editan archivos globales que ningún run consume (G4).

**Files:**
- Modify: `orquesta_api/services/config_files.py` (constructor recibe `workspace: Path`; escritura = read-modify-write del dict crudo, tocando solo claves editadas), `orquesta_api/routers/flows.py`, `orquesta_api/routers/teams.py` (rutas nuevas `/projects/{project_id}/flows[...]` y `/projects/{project_id}/team`, resolviendo workspace desde `ProjectService`), `lib/orq-lite.ts` + páginas de flows/team (scoping por proyecto: selector de proyecto en ambas pantallas)
- Test: `test/test_config_roundtrip.py`

**Interfaces:**
- Produces: `TeamConfigStore(workspace).update(patch: dict)` donde el patch se mergea **sobre el JSON leído** (preservando `rate_limit_backoff`, `limits.preflight_enabled`, `limits.fast_mode` y cualquier campo futuro); ídem `FlowConfigStore(workspace)`. Los endpoints globales `/flows` y `/teams` se eliminan (breaking interno, la UI es el único consumidor).

- [ ] **Test de oro (regresión del bug):** cargar el `team.json` que scaffoldea `orq-lite init` (fixture copiada de `orquesta-lite/internal/commands/assets/team.json`), editar `full_test_command` vía el store, releer el archivo → `rate_limit_backoff` intacto y **el JSON pasa las reglas de `config.Validate`** (test espejo mínimo en Python: agents no vacíos, roles con prompt/result_path/timeout, `rate_limit_backoff.initial_seconds>0`, `factor>=2`).
- [ ] TDD → commit `fix(config): per-project stores with lossless raw round-trip`

### Task 6: Editor de flows alineado al schema real del engine

**Files:**
- Modify: `lib/types.ts` + `orquesta_api/meta/models.py` (reemplazar `FlowStep`/`FlowDefinition` por el schema del engine: `Step{type, agent?, command?, args?, action?, inputs?, outputs?, iterator?, as?, body?, condition?, max_retries?, expression?, on_failure?}`, `Flow{description?, inputs?: Record<string,{type?,default?}>, steps}` — fuente: `orquesta-lite/internal/engine/engine.go:37-79`), `components/console/flow-manager.tsx` (editor por tipo de step + vista JSON), `orquesta_api/services/config_files.py` (normalización sin invención de campos)
- Test: `test/test_flow_schema.py`

**Interfaces:**
- Validación server-side al guardar, espejo de las reglas de `engine.Validate` de orq-lite (su plan Task 12): `type` ∈ {agent,command,action,loop,retry_until,eval}; exactamente uno de `command`/`args` en command steps; `loop` requiere `iterator`+`as`; `retry_until` requiere `condition`; `on_failure` ∈ {"", "continue"}. Errores → 422 con detalle por step.
- Criterio de aceptación: leer el `flows.json` bundled de orq-lite → editar description → guardar → `orq-lite flow run <name>` (binario real) sigue parseándolo y `git diff` del archivo muestra **solo** la línea tocada.

- [ ] TDD → regenerar `flow-manager.tsx` sobre el schema nuevo → commit `feat(flows): engine-schema flow editor with server-side validation`

---

## Fase 2 — Eventos y estado vivo multi-proyecto

> Merece su propio pase de writing-plans. Contratos cerrados:

### Task 7: EventBus + SSE agregado
- Create: `orquesta_api/services/events.py`, `orquesta_api/routers/events.py`.
- Un consumidor por serve de proyecto (el de Task 2): suscripción a `GET /api/events` (SSE) vía httpx streaming, con reconexión exponencial y resume por `EventCursorRow` (offset de líneas de run.log ya replayadas). Cada evento se re-emite estampado con `project` (el modelo `RunEvent` gana `model_config = ConfigDict(extra="allow")` para dejar pasar `run_id` y campos futuros de orq-lite Tasks 6–7).
- Endpoints: `GET /events` (global) y `GET /projects/{id}/events`, heartbeat 15s, eventos de lifecycle propios (`run_started`, `run_finished` emitidos por el supervisor de Task 3 — reemplaza el stub `_emit_event` de `services/runs.py:162`).
- `lib/types.ts` `EventKind` gana `run_started|run_finished|task_routed` (spec §5.1).
- **Fixes de contrato de roles** (bloquean la Task 8b): `RunEvent.role` pasa de `AgentRole | None` a `str | None` (`meta/models.py:118` — los eventos reales traen `planner|verifier|generalist|architect|…` y el enum de 5 valores los rechaza); `_VALID_ROLES` del proxy de results (`routers/projects.py:16`) se reemplaza por validación `^[a-z0-9_-]{1,32}$` y se delega la whitelist al serve de orq-lite (que devuelve `null` para roles desconocidos, `web/server.go:95-104`).

### Task 8: Frontend live multi-proyecto
- `live-events.tsx` conecta a `/api/control-plane/projects/{id}/events` (el proxy ya streamea; verificar flushing) y el dashboard global a `/api/control-plane/events`; eliminar `app/api/orq-lite/events/route.ts` y `ORQ_LITE_API_URL` (el modo mono-instancia muere: el control plane es el único origen).
- Estados de conexión visibles (connecting/streaming/error) en el header del panel.

### Task 8b: Oficina virtual por proyecto (gameboard productizado)

Port a producto de la vista más distintiva de orq-lite: la oficina pixel-art donde cada rol es un escritorio, un avatar camina entre ellos (WASD/d-pad) y "hablar" con un agente (E/click) abre su estado vivo. Origen: `orquesta-lite/internal/web/static/gameboard.js` (652 líneas, React UMD sin build, mono-proyecto, 8 roles hardcodeados). En orquesta pasa a ser un componente TypeScript nativo del console, **por proyecto**, con roles dinámicos desde `team.json` y datos del control plane.

**Files:**
- Create: `app/projects/[id]/office/page.tsx` (server component: carga `Project` + team + flows, monta el stage), `components/office/office-stage.tsx` (client: stage, movimiento, colisiones, rAF), `components/office/role-panel.tsx` (panel con tabs), `components/office/hud.tsx`, `components/office/sprites.ts` (grid `SPR` + paleta + render por `box-shadow`, portado tal cual de `gameboard.js:52-57,319-332`), `components/office/layout.ts` (posicionamiento de escritorios), `components/office/status.ts` (derivación de estado por eventos), `lib/use-office-data.ts` (hook de datos), `components/office/__tests__/{layout,status,palette}.test.ts`
- Modify: `components/console/project-view.tsx` (tab/botón "Office" en `ProjectActions`), `components/console/console-sidebar.tsx` (entrada por proyecto activo), `package.json` (dev dep nueva aprobada: `vitest` + `@vitest/ui`; script `"test": "vitest run"`)

**Interfaces:**
- Consumes: SSE per-proyecto de Task 7/8 (`/api/control-plane/projects/{id}/events`), `GET /api/control-plane/projects/{id}` (tasks/features/cost embebidos), `GET /api/control-plane/projects/{id}/result/{role}` (con el fix de whitelist de Task 7), `GET /api/control-plane/projects/{id}/diff/{task}`, team per-proyecto de Task 5 (`GET /api/control-plane/projects/{id}/team`), launcher de Task 4 (`POST .../runs`).
- Produces:

```ts
// components/office/layout.ts
export interface Desk { role: string; x: number; y: number; hub: boolean }
// Los 8 roles conocidos usan las posiciones y paleta del gameboard original
// (gameboard.js:58-67,71-80). Con N roles custom extra, layoutDesks() ubica el
// hub (orchestrator) al centro y distribuye el resto en anillo elíptico
// (cx=470, cy=310, rx=390, ry=240), sin solapamiento (mínimo 130px entre centros).
export function layoutDesks(roles: string[]): Desk[]

// components/office/status.ts — reemplaza la heurística posicional del PIPE
// (gameboard.js:347-356), que asume el pipeline legacy y no sirve para flows.
export type DeskStatus = "working" | "done" | "failed" | "waiting" | "idle" | "coord"
export function deskStatus(role: string, events: RunEvent[], runActive: boolean): DeskStatus
// working: último agent_run del rol es el último agent_run global y runActive.
// done/failed: status del último agent_run del rol en el run actual (delimitado
//   por el último run_started). waiting: task in_progress con last_agent=rol.
//   idle: sin actividad en el run actual o !runActive. coord: reservado al hub.

// components/office/sprites.ts
export interface RoleIdentity { label: string; color: string; skin: string; hair: string; desc: string }
export function roleIdentity(role: string): RoleIdentity
// Los 8 conocidos conservan su identidad del gameboard; un rol custom recibe
// color determinístico por hash del nombre sobre una paleta de 12 colores
// accesibles (contraste ≥3:1 sobre #15102b), skin/hair rotados por el mismo
// hash, label = nombre en mayúsculas, desc = "Custom role from team.json".
```

- [ ] **Step 1: Tests de las funciones puras** — `layout.test.ts`: 8 roles → posiciones exactas del gameboard; 12 roles → sin solapamiento (distancia mínima entre centros ≥130px) y hub al centro; 0 roles → solo hub. `status.test.ts`: fixture de eventos (run_started → agent_run coder ok → agent_run tester fail) → coder `done`, tester `failed`, critic `idle`; `runActive=false` → todos `idle`. `palette.test.ts`: mismo nombre → mismo color (determinismo); nombres distintos de los 12 primeros → colores distintos.
- [ ] **Step 2: `uv`/`pnpm` verde en rojo primero** — `pnpm vitest run` → FAIL (módulos no existen). Implementar `layout.ts`, `status.ts`, `sprites.ts` hasta verde.
- [ ] **Step 3: Hook de datos** — `use-office-data.ts`: estado `{tasks, features, cost, events, results, diffs, connection: "connecting"|"live"|"error"}`; snapshot inicial desde el `Project` embebido (props del server component), refresh de tasks/factory cada 3s **solo con run activo** (sin run: nada de polling — la oficina en reposo no gasta), SSE con reconexión exponencial (1s→30s) y resume visual del estado `connection`; results/diffs lazy al abrir panel (cache por rol/task como `gameboard.js:379-388`). Pausa total (rAF + polling + SSE cerrado) con `document.visibilityState === "hidden"`, reanuda al volver.
- [ ] **Step 4: Stage** — `office-stage.tsx` portando el modelo del gameboard con sus decisiones de perf intactas: movimiento y colisiones **fuera de React state** (refs + rAF, `gameboard.js:291-311`), sprites cacheados por `box-shadow` (`gameboard.js:319-332`), cap de 600 eventos, escala responsive (`calcScale`). Overlay SVG de flujo: spokes desde el hub a cada desk + token pulsante sobre el rol activo (`gameboard.js:454-467`); **sin** la polyline del PIPE (no hay pipeline fijo con flows dinámicos). CRT overlay togglable (persistido en `localStorage`, key `orq-office-crt`). D-pad táctil con pointer events en `<lg`, safe-area insets.
- [ ] **Step 5: Panel de rol** — `role-panel.tsx` con las 4 tabs del original (STATE: task actual + activity feed de los últimos 6 `agent_run` del rol + chips status/agent/duración/runs; SUMMARY: `notes_for_memory|summary` del result; JSON: result crudo con highlighting; CHANGES: diff colorizado del commit de la task actual). Accesibilidad: el panel es `role="dialog"` con focus trap y `Esc`; cada desk es un `<button>` focusable (Tab navega escritorios, Enter abre) — **la oficina es 100% operable sin WASD**; `prefers-reduced-motion` desactiva bob/float/pulso/CRT y el token pasa a estático.
- [ ] **Step 6: HUD** — franja superior: nombre del proyecto + feature/branch activos, run activo (kind/flow + `orq_run_id` cuando exista — Task 9/I5), chips de roles (click = abrir panel), done/total tasks, ciclo, spend, elapsed + estado de conexión. Acción "Run flow" integrada (reusa el launcher de Task 4; con run activo muestra "Stop" → `POST /runs/{id}/stop`). Empty states explícitos: proyecto sin `team.json` → oficina vacía con CTA "run orq-lite init"; sin run activo → oficina en reposo (avatares idle, HUD "idle — last run <ts>").
- [ ] **Step 7: Wiring** — ruta `app/projects/[id]/office/page.tsx` (`dynamic = "force-dynamic"`), botón "Office" en `ProjectActions` y link en el sidebar. El modo pantalla completa oculta el chrome del console (layout propio del segmento).
- [ ] **Step 8: Verificación manual** — factory `--fast` real sobre el repo de juguete con la oficina abierta: el token sigue al rol activo, panel muestra results reales, CHANGES muestra el diff del commit, mobile (viewport 390px) navegable con d-pad, `prefers-reduced-motion` verificado con emulación de DevTools.
- [ ] **Step 9: Commit** — `feat(office): per-project virtual office view with dynamic roles`

**Fuera de alcance (anotado para Fase 3+):** tab CHANGES por intento (requiere orq-lite Task 9, artefactos `attempt.diff`) y replay histórico de un run terminado (requiere Task 11b — la oficina reproduce el timeline de `/api/runs/{id}/events` a velocidad configurable, feature "VCR"). El lobby multi-proyecto (un edificio, un piso por proyecto) queda como idea v2 — no bloquea nada.

---

## Fase 3 — Historia, costo y run detail (consume orq-lite Task 11b)

> Bloqueada por: orq-lite Task 11b (query API) y Tasks 8–9 (artefactos/diffs). Merece writing-plans propio.

### Task 9: Proxy de la query API + pantallas de historia
- `Aggregator` gana `list_runs/get_run/get_run_events/get_agent_runs/get_cost_stats` proxying `GET /api/runs`, `/api/runs/{id}/events`, `/api/agent-runs`, `/api/stats/cost` del serve del proyecto (contrato: `orquesta-lite/docs/query-api.md` cuando lande).
- Correlación: al ver `run_start` en el SSE (Task 7), el supervisor guarda `orq_run_id` en `RunRow` (columna nueva) → el run de orquesta linkea 1:1 con la historia de orq-lite (propuesta I5).
- Frontend: pestaña "Runs" en project view (lista + run detail con timeline de eventos, agent-runs con duración/tokens, links a `artifacts_dir`, diff por intento vía `GET /api/attempt-diff/...` de orq-lite Task 9), y dashboard de costo (`/api/stats/cost?by=project|run|agent`).

### Task 10: Launcher de flows schema-driven
- Con I1 (`GET /api/flows` en serve): el selector de `ProjectActions` (Task 4) se reemplaza por un formulario generado desde los `inputs` del flow (tipo+default+required) con el estado de preflight por rol visible; deshabilitar lanzar si doctor (I2) reporta rojo.

---

## Fase 4 — Chat centralizado real (P3)

> Merece writing-plans propio. Decisiones cerradas (D5 del assessment):

### Task 11: ChatService con tool-use sobre la propia API
- Create: `orquesta_api/services/chat.py`, `orquesta_api/routers/chat.py`, tablas `ConversationRow`/`ChatMessageRow`.
- El backend llama a la API de Anthropic (`anthropic` SDK, dependencia nueva aprobada para esta fase; modelo configurable, default `claude-sonnet-5`) con tools que mapean 1:1 a operaciones existentes: `list_projects`, `get_project_status`, `launch_run(kind=flow,...)`, `toggle_watch`, `register_project`, `append_feature` (esta última = escribir en `<workspace>/features.md` vía… **no**: respeta la constraint — se agrega como input del flow factory, o se implementa como paso `command` del flow; decisión al ejecutar la fase).
- Respuesta streaming SSE (`POST /chat` → `text/event-stream` con deltas + tool events); `action` mantiene el vocabulario del frontend (`pending|in_progress|done|needs_human|needs_clarification`).
- Persistencia: conversaciones por usuario (single-user v1), `GET /chat/history`.
- Frontend: `global-chat.tsx` deja `seedChat`, carga historia real, renderiza tool-calls ("lancé el flow pr_review en atlas-api → run r2026…"), streaming token a token. Eliminar `OPENCODE_SERVER_URL` y el motor de regex de `app/api/chat/route.ts` (la ruta pasa a proxy del control plane).

---

## Fase 5 — Auth + watchers (P4)

### Task 12: Bearer auth end-to-end
- Middleware FastAPI: `Authorization: Bearer <settings.auth_token>` en toda ruta salvo `/health`; **arranque falla** si `auth_token` está vacío y `ENV=production` (hoy el default vacío deshabilita auth en silencio, `config.py:17`).
- El proxy de Next inyecta el token desde `ORQUESTA_API_TOKEN` (server-side only, nunca `NEXT_PUBLIC_*`); página de login simple con cookie httpOnly para gatear el dashboard (middleware de Next).

### Task 13: Webhooks GitHub centralizados (decisión D4)
- Create: `orquesta_api/core/integrations/github.py` (verificación `X-Hub-Signature-256` HMAC), `orquesta_api/services/watchers.py`, ruta `POST /webhooks/github`.
- Mapeo: PR opened/synchronize + `watch.prs` → `launch(kind=flow, flow="pr_review", inputs={pr_number, publish:"true"})`; issue opened + `watch.issues` → `flow="issue_fix"` (flows de orq-lite Fase 3). Dedupe por delivery ID; eventos no matcheados → 204.
- Fallback sin webhook: botón "start watch daemon" que supervisa `orq-lite watch --prs --issues` como un run kind `watch` de larga vida (reusa Task 3).

---

## Fase 6 — Docker executor + deploy (P2)

### Task 14: DockerExecutor + containers router
- Según spec §7.2/§9: `core/integrations/docker_client.py` (SDK oficial, llamadas bloqueantes con `asyncio.to_thread`), labels `orquesta.managed/project/run`, mounts de credenciales (`settings.creds_mounts`) y workspace, imagen `settings.orq_lite_image`. Nota: dentro del contenedor el serve del proyecto (Task 2) también corre containerizado con puerto mapeado — `ServeManager` gana backend docker.
- `routers/containers.py` (list/inspect/logs/stop/restart, 501 con executor local) + `/images/pull`.

### Task 15: Empaquetado de orquesta
- `Dockerfile` (multi-stage: web build + api), `docker-compose.yml` (api + web + volumen workspaces + socket docker opcional), `.env.example` con todas las settings de `config.py`, `docs/deploy.md`.
- La imagen del API incluye el binario `orq-lite` **pineado por versión + sha del release** (build arg `ORQ_LITE_VERSION` con default explícito — al 2026-07-01 el último tag publicado es `v0.1.9`; nunca `latest`). No se seedean `flows.json`/`team.json` "de deploy" en volúmenes: la config es per-workspace y la genera `orq-lite init` en el launch (Task 1 Step 8) — un seed global en `/data` recrearía el gap G4.

---

## Fase 7 — Hardening y bugs conocidos

### Task 16: Cliente orq-lite robusto
- `OrqLiteClient` con `httpx.AsyncClient` compartido (lifespan), `timeout=httpx.Timeout(5.0, read=30.0)`, y captura de `httpx.HTTPStatusError` (hoy escapa el `except RequestError` y sale 500 sin mapear, `orq_lite_client.py:41-50`) → `RuntimeError` (502) con status upstream en el mensaje.

### Task 17: Migraciones Alembic
- `alembic init`, autogenerate inicial desde `Base`, reemplazar `create_all` del lifespan por check de versión; CI corre upgrade+downgrade.

### Task 18: Frontend production hygiene
- Quitar `generateStaticParams` de `app/projects/[id]/page.tsx:6-9` (datos vivos → `dynamic = "force-dynamic"`); `loading.tsx`/`error.tsx` en `/dashboard` y `/projects/[id]`; arreglar `package.json` (`eslint` + config faltantes, script `typecheck: tsc --noEmit`); gate explícito de mock data: `ORQUESTA_DEMO=1` habilita mocks, sin la var un backend caído muestra error, no demo (`lib/orq-lite.ts:30-66`).

### Task 19: CI + tests de contrato
- GitHub Actions: job Python (ruff+pytest) + job web (typecheck+lint+build).
- Test de contrato Pydantic↔types.ts (spec §14): serializar cada modelo y comparar claves contra un snapshot generado de `lib/types.ts` (script `scripts/gen-ts-contract.ts`).
- Smoke E2E marcado `@pytest.mark.orqlite`: con el binario real, registrar proyecto de juguete → launch `factory --fast` sobre un repo trivial con stub de agente `cmd` → run llega a terminal state y el snapshot muestra tasks.

---

## Tareas propuestas en orquesta-lite (para agregar a su plan)

Detalle y justificación en el assessment §5. Ninguna viola la constraint read-only del serve:

- [ ] **I1 — `GET /api/flows`** (extensión de su Task 21): flows + inputs (tipo/default) + roles requeridos + preflight por rol. Desbloquea Task 10 de este plan.
- [ ] **I2 — `GET /api/doctor`**: preflight en JSON. Desbloquea el gating del launcher (Task 10).
- [ ] **I3 — `GET /api/team`**: `team.json` efectivo crudo. Necesario cuando el executor es Docker (Fase 6) y el filesystem no es accesible.
- [ ] **I4 — token bearer opcional en serve** (`ORQ_LITE_SERVE_TOKEN`): requerido antes de mapear puertos de serve fuera de loopback (Fase 6).
- [ ] **I5 — criterio de aceptación sobre su Task 11b**: `GET /api/runs?active=true` expone el run en curso con su `run_id` (correlación del supervisor, Task 9 de este plan).
- [ ] **I6 (v2, anotado, no implementar)** — `POST /api/trigger/{flow}` autenticado para ejecución remota sin supervisión de procesos.

## Orden de ejecución y dependencias

```
Fase 0 (T1-T4)   → sin dependencias externas. Desbloquea la demo real end-to-end.
Fase 1 (T5-T6)   → independiente de Fase 0 (paralelizable). T6 se apoya en las reglas de
                   orq-lite Task 12 pero no la requiere landeada.
Fase 2 (T7-T8b)  → requiere Fase 0 (serve por proyecto + supervisor). Se beneficia de
                   orq-lite Tasks 6-7 (run_id + eventos lifecycle) pero no las bloquea.
                   T8b (oficina) requiere T7 (SSE per-proyecto + fixes de contrato de
                   roles) y T5 (team per-proyecto); su modo histórico/VCR queda para
                   Fase 3 (11b).
Fase 3 (T9-T10)  → BLOQUEADA por orq-lite Task 11b (+ Tasks 8-9 para artifacts/diffs)
                   y por I1/I2/I5. Empezar cuando su Fase 1 esté landeada.
Fase 4 (T11)     → requiere Fase 0; mejor tras Fase 2 (el chat reporta por eventos).
Fase 5 (T12-T13) → T12 independiente (puede adelantarse); T13 requiere flows por defecto
                   de orq-lite Fase 3 (pr_review/issue_fix bundled).
Fase 6 (T14-T15) → requiere Fase 0; I4 antes de exponer puertos.
Fase 7 (T16-T19) → T16-T18 paralelizables desde el día 1; T19 al final de cada fase.
```

## Self-Review (checklist ejecutado)

- **Cobertura vs assessment:** G1→T1 (argv+cwd+flow, workspace init en Step 8) y T1b (modelos tolerantes al JSON real: `omitempty` de `verify_state/last_agent/cost_usd`, `last_agent` como nombre de agente), G2→T3, G3→T5-T6, G4→T5, G5→T4, subsistemas ausentes→T7 (events), T11 (chat), T12-T13 (auth/watchers), T14-T15 (docker, con binario orq-lite pineado por versión+sha), G6→T9-T10, G7→T16-T19, G8→T4/T8b (oficina virtual)/T9/T10/T12; los dos bugs de contrato de roles de G8 (a)/(b)→T7. Propuestas I1-I6 listadas con dependencias. Sin gaps detectados.
- **Placeholders:** Fases 2-7 declaran explícitamente que requieren su propio pase de writing-plans; los contratos (firmas, rutas, semántica, criterios de aceptación) quedan definidos acá.
- **Consistencia de tipos:** `RunSpec.flow/inputs` (T1) es lo que consume el launcher (T4) y los watchers (T13); `ServeManager` (T2) es lo que consume el Aggregator (T2/T9) y el EventBus (T7); `orq_run_id` (T9) depende del SSE de T7 e I5.

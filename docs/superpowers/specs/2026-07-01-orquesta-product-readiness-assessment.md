# orquesta — Product Readiness Assessment

**Fecha:** 2026-07-01
**Propósito del producto:** orquesta es el **control plane web multi-proyecto** sobre orq-lite: registro de proyectos/repos, lanzamiento y supervisión de runs (flows dinámicos de orq-lite), estado agregado en vivo, y un **chat centralizado** que opera todos los proyectos por lenguaje natural. orq-lite sigue siendo el orquestador de flows por proyecto (AFK); orquesta no lo reemplaza, lo multiplexa.

**Referencias:**
- Spec del backend: `docs/backend-api-features.md` (P1–P4, 2026-06-28)
- Plan de orq-lite en ejecución: `orquesta-lite/docs/superpowers/plans/2026-07-01-product-readiness.md`
- Assessment de orq-lite: `orquesta-lite/docs/superpowers/specs/2026-07-01-product-readiness-assessment.md`

---

## 1. Estado actual — qué existe y funciona

### Backend (`orquesta_api/`, FastAPI) — P1 parcial (~40%)
- **Registro de proyectos** completo: CRUD con slug, clone/adopt vía `RepoManager` (`services/projects.py`, `services/repos.py`), dedupe por slug y por workspace, prune de workspaces managed.
- **Repos**: `status`/`sync` con guards de dirty y run-in-flight (`services/repos.py:82-111`), git por subprocess (`core/integrations/git.py`) con manejo de errores correcto.
- **Runs (esqueleto)**: tabla `RunRow`, `RunSupervisor.launch/stop/get/list` (`services/runs.py`), `LocalExecutor` con SIGTERM→SIGKILL, captura de stdout en memoria y streaming SSE con heartbeat (`routers/runs.py:40-58`).
- **Aggregator**: proxy de `/api/tasks|factory|cost|diff|result` del serve de orq-lite del run activo (`services/aggregator.py`), snapshot vacío si no hay run (coherente con el spec §8.1).
- **Config stores**: `FlowConfigStore`/`TeamConfigStore` leen/escriben `flows.json`/`team.json` **globales** (`services/config_files.py`).
- Manejo de excepciones→HTTP centralizado (`main.py:30-65`), settings tipados (`config.py`), logging propio.

### Frontend (Next.js 16 / React 19, App Router)
- UI completa y pulida: dashboard con stats, registry, project detail (Factory/Tasks/Chat + live events rail), flows manager, team manager, chat global, landing.
- Capa de datos server-side (`lib/orq-lite.ts`) con 3 orígenes en cascada: control plane (`ORQUESTA_API_URL`) → orq-lite directo (`ORQ_LITE_API_URL`) → mock.
- Proxy genérico al control plane (`app/api/control-plane/[...path]/route.ts`) que preserva método/headers/stream.
- SSE de eventos vía `app/api/orq-lite/events/route.ts` → `EventSource` en `live-events.tsx`.

### Lo que el spec promete y NO existe (ni stub)
| Subsistema (spec) | Estado |
|---|---|
| `services/events.py` EventBus + `routers/events.py` (`GET /events`, `/projects/{id}/events`) | **ausente** — `EventCursorRow` existe pero nadie la usa |
| `services/chat.py` ChatService + `POST /chat` (P3) | **ausente** |
| `services/watchers.py` + `core/integrations/github.py` + `POST /webhooks/github` (P4) | **ausente** |
| Auth middleware (P4) — `settings.auth_token` existe pero nada lo valida | **ausente** |
| `executors/docker.py` + `core/integrations/docker_client.py` + `routers/containers.py` (P2) | **ausente** |
| Tests — `pyproject.toml:52-58` ignora archivos de `test/` **que no existen en el repo** | **cero tests** |
| `run_started`/`run_finished` en el bus | stub: `RunSupervisor._emit_event` solo loggea (`services/runs.py:162-163`) |

---

## 2. Gaps críticos

### G1. Los runs no pueden lanzarse — el comando construido es inválido (P0)
`LocalExecutor.start` construye `[orq-lite, --addr, 127.0.0.1:<port>, *spec.args]` (`executors/local.py:33`). El CLI de orq-lite exige **subcomando primero** (`cmd/orq-lite/main.go:24-28`): `orq-lite --addr …` cae en `default: usage(); os.Exit(2)`. Además:
- **No setea `cwd=spec.workspace_path`** → aunque el argv fuera válido, correría sobre el directorio del API, no sobre el proyecto.
- `spec.kind`, `spec.plan_path` y `spec.serve` se ignoran por completo — `RunKind` es decorativo.
- `RunKind` = `run|factory|plan` (`meta/models.py:71-74`): **no existe `flow`**, que es la vía de ejecución a la que converge orq-lite (los 3 flows por defecto del plan de orq-lite Fase 3 se lanzan con `orq-lite flow run <name> key=value`). El control plane no puede lanzar el producto principal.
- `orq-lite flow run` **no tiene `--serve/--addr`** (`main.go:220-270`) → aún con argv correcto, un flow run no expondría API que el Aggregator pueda leer. Ver decisión D1 (§4).

### G2. Sin supervisión ni finalización de runs (P0)
- Nadie espera el exit del proceso: `RunRow.state` queda `running` para siempre salvo `stop()` manual; `exit_code`/`finished_at` solo se persisten en el path de stop (`services/runs.py:113-135`), y ahí `exit_code=1` se hardcodea aunque el proceso hubiera terminado bien antes del stop.
- El estado del executor vive en dicts en memoria (`executors/local.py:26-28`): un restart del API **huérfana los procesos** (siguen corriendo sin handle) y deja la DB mintiendo `running`. No hay reconciliación al startup.
- `Aggregator._active_run` usa `scalar_one_or_none` (`services/aggregator.py:83-90`): dos runs `running` del mismo proyecto (nada lo impide — `launch` no tiene guard de run activo, solo `sync` lo chequea) → `MultipleResultsFound` → 500.
- `ProjectRow.state`, `last_run` y `cost_usd` nunca se actualizan desde los runs — el dashboard multi-proyecto muestra estado muerto.
- `_log_cache` acumula stdout completo en memoria sin límite ni persistencia (`executors/local.py:27`): runs de factory de horas = OOM, y los logs se pierden al reiniciar.

### G3. Los editores de flows/team escriben archivos que orq-lite no puede consumir (P0 — corrupción de config)
1. **`FlowDefinition` no es el schema del engine.** orquesta modela `{id, name, team_id, entrypoint, variables, steps: [{id, label, command, args, role, depends_on}]}` (`meta/models.py:261-281`, `lib/types.ts:173-193`). El engine real parsea `{flows: {name: {description, inputs: {k: {type, default}}, steps: [{type, agent, command, args, action, inputs, outputs, iterator, as, body, condition, max_retries, expression, on_failure}]}}}` (`orquesta-lite/internal/engine/engine.go:37-79`). Consecuencias:
   - `FlowConfigStore.list()` sobre un `flows.json` real **descarta** `type/agent/action/inputs/outputs/iterator/body/condition/…` (`services/config_files.py:75-105`).
   - Guardar desde la UI (`PUT /flows/{id}` → `_dump_flow`) **destruye el flow**: reescribe steps sin `type` → `engine` los rechaza o los ignora. Round-trip = pérdida de datos.
2. **`TeamConfigStore` rompe `team.json`.** `_dump_team` escribe solo `agents/roles/limits/full_test_command/lint_command/conventions_file` (`services/config_files.py:177-193`) y **omite `rate_limit_backoff`**, que `config.Validate()` de orq-lite exige (`orquesta-lite/internal/config/config.go:326`: `initial_seconds>0`, `factor>=2`) → un `team.json` guardado desde orquesta hace fallar `config.Load` y **ningún comando de orq-lite vuelve a arrancar en ese proyecto**. Además `TeamLimits` no modela `preflight_enabled` ni `fast_mode` (`config.go:70,102`) → se pierden al guardar. Patrón correcto: read-modify-write sobre el JSON crudo preservando campos desconocidos, no serializar desde un modelo cerrado.

### G4. Config global vs per-proyecto (diseño)
`FLOWS_PATH`/`TEAM_PATH` apuntan a **un** archivo global en el cwd del API (`config.py:15-16`), pero orq-lite lee `team.json`/`flows.json` **del workspace donde corre** (`main.go:60,266-268`). Los managers de Flows/Team editan un archivo que ningún run consume. Cada proyecto registrado tiene su propia config scaffoldeada por `orq-lite init`; el control plane debe editar `<workspace>/team.json` y `<workspace>/flows.json` per-proyecto (rutas `/projects/{id}/flows`, `/projects/{id}/team`), con la config global a lo sumo como *template* para proyectos nuevos.

### G5. Frontend desconectado de las mutaciones (P0 UX)
- `registry-table.tsx`: alta de proyecto y toggles de watchers son **estado local puro** (`registry-table.tsx:51-87`) — nunca llaman `POST /projects` ni `PATCH /projects/{id}`. Gap ya documentado en el spec §15, sin resolver.
- `ProjectActions` → botón "Run factory" **sin `onClick`** (`project-view.tsx:94-104`). No hay ninguna UI que lance runs.
- `ProjectPatch.watch: bool` colapsa PRs+issues en un solo booleano (`routers/projects.py:53`, `services/projects.py:115-117`) mientras la UI tiene toggles separados — el PATCH no puede expresar el estado real.
- `live-events.tsx` conecta a **un solo** orq-lite global (`/api/orq-lite/events` → `ORQ_LITE_API_URL`), no al proyecto que muestra; y **inyecta eventos mock cada 4s en modo live** (`live-events.tsx:109-118`) — datos fabricados indistinguibles de reales.
- Chat: `global-chat.tsx` arranca con `seedChat` mock, sin persistencia, sin streaming; `/api/chat` es un motor de regex que **dice** que ejecuta acciones pero no ejecuta nada (`app/api/chat/route.ts:58-126`). `OPENCODE_SERVER_URL` es un contrato inexistente.
- La cascada de fallbacks a mock (`lib/orq-lite.ts:30-66`) hace que un backend caído sea **indistinguible de un ambiente demo** — en producción, un error debe verse como error.

### G6. Trazabilidad e historia: hoy solo existe "el run activo"
El Aggregator solo lee el serve del run `running`; sin run activo → snapshot vacío. No hay: historia de runs navegable, timeline de eventos por run, diffs por task/intento, costo por run/agente, artefactos. Todo esto lo desbloquea el plan de orq-lite Fase 1 (run IDs Task 6, eventos lifecycle Task 7, artefactos Task 8, diffs Task 9, costo first-party Task 10, **query API SQLite Task 11b** — cuyo contrato público `docs/query-api.md` fue diseñado explícitamente para orquesta como "app acompañante"). orquesta hoy no consume nada de eso ni tiene las pantallas.

### G7. Hardening de producción
- **Cero tests** (el directorio `test/` referenciado en `pyproject.toml` no existe). Sin CI, sin quality gate.
- **Sin migraciones**: `create_all` en lifespan (`main.py:24-26`); cualquier cambio de schema en SQLite/Postgres productivo = manual.
- `OrqLiteClient`: `AsyncClient` nuevo por request, **sin timeout** (un serve colgado = request del control plane colgada), y `raise_for_status()` lanza `HTTPStatusError` que **no** es `RequestError` → escapa el `except` (`orq_lite_client.py:41-50`) y sale como 500 sin mapear.
- Auth: `auth_token` default `SecretStr("")` = auth silenciosamente deshabilitada; el proxy de Next reenvía headers pero nadie los valida en ninguna punta.
- `orq-lite serve` no tiene auth ni CORS (`internal/web/server.go`) — aceptable en loopback, bloqueante si Docker mapea puertos.
- Frontend: `package.json` declara `"lint": "eslint ."` **sin eslint en devDependencies**; no hay script de typecheck; no hay `loading.tsx`/`error.tsx` en ningún segmento; `generateStaticParams` sobre datos vivos (`app/projects/[id]/page.tsx:6-9`) hornea IDs en build.
- No hay Dockerfile/compose de orquesta, ni `.env.example`, ni deploy docs. `docs/conventions/collectiveai-python.md` referenciado por el spec no existe en el repo.

### G8. Superficies de producto faltantes (frontend)
Para operar AFK multi-proyecto faltan: (1) launcher de flows con formulario generado desde los `inputs` del flow; (2) historia de runs + run detail (timeline, agent-runs, artifacts, diff por intento); (3) dashboard de costo (por proyecto/run/agente); (4) cola de `needs_human`/handoffs con notificaciones; (5) visor de logs de run; (6) login; (7) settings (tokens, executor, workspaces_dir); (8) **la oficina virtual (gameboard)** que orq-lite ya shippea por proyecto (`orquesta-lite/internal/web/static/gameboard.js`, 652 líneas de React UMD sin build) no existe en el console — es la vista más distintiva del producto y hoy solo vive en el serve embebido, con los 8 roles del pipeline legacy **hardcodeados** (`gameboard.js:58-80`) y una heurística posicional de estado (`statusFor`, `gameboard.js:347-356`) que no representa flows dinámicos ni roles custom (architect/qa/pm/medic).

Dos bugs de contrato que el port de la oficina destapa: (a) `_VALID_ROLES` del proxy de results se construye del enum `AgentRole` de 5 roles (`routers/projects.py:16`) — bloquea `planner/verifier/orchestrator` que el serve de orq-lite sí whitelistea (`web/server.go:53-56`) y cualquier rol custom; (b) `RunEvent.role: AgentRole | None` (`meta/models.py:118`) hace fallar la validación Pydantic de eventos reales con `role=verifier|planner|generalist` — debe ser `str`.

---

## 3. Contrato de integración con orq-lite — estado y dependencias

**Lo que orquesta consume hoy** (todo read-only, correcto): `GET /api/tasks|factory|cost|events(SSE)|result/{role}|diff/{task}` del serve embebido.

**Lo que el plan de orq-lite le da a orquesta** (mapeo directo):

| Task orq-lite | Qué desbloquea en orquesta |
|---|---|
| 6 (run_id + run_start/run_end + manifest) | Correlación run de orquesta ↔ run de orq-lite; detección de fin de run por eventos además de exit del proceso |
| 7 (task/cycle lifecycle events) | Live events completos (hoy la UI ya renderiza esos tipos que nunca llegan) |
| 8–9 (artefactos + diffs por intento + endpoint attempt-diff) | Run detail con prompts/stdout/diffs por intento |
| 10 (costo first-party en tokens) | Costo sin agtop dentro de contenedores |
| **11b (proyección SQLite + query API en serve)** | **Historia entre corridas**: `/api/runs`, `/api/runs/{id}/events`, `/api/agent-runs`, `/api/stats/cost` — la fuente para las pantallas de historia/costo. Contrato: `docs/query-api.md` |
| 12 (validación estática de flows) | Referencia para validar flows editados en la UI antes de guardar |
| 18 (watch → flows) | El daemon `watch` que orquesta supervise dispara los mismos flows que orquesta lanza a mano |
| 21 (`flow list`) | Base para exponer flows+inputs por HTTP (ver propuesta I1) |

**Restricción a respetar:** el serve de orq-lite es y seguirá siendo **read-only** (constraint global del plan de orq-lite). Toda escritura (lanzar runs, editar config) pasa por orquesta spawneando el CLI con cwd en el workspace — la arquitectura de executor ya elegida es la correcta.

---

## 4. Decisiones de diseño recomendadas

**D1. Un `orq-lite serve` persistente por proyecto; runs headless.** En lugar de acoplar el api_port al run (`--serve` del run/factory, que `flow run` ni siquiera tiene), orquesta levanta y supervisa un `orq-lite serve --addr 127.0.0.1:<puerto-libre>` por proyecto registrado (cwd=workspace) y lanza los runs **sin** dashboard propio. Beneficios: (1) funciona igual para `run`, `factory` y `flow run`; (2) el Aggregator lee estado aunque no haya run activo (tasks/factory/cost persisten en `.orquestalite/`); (3) cuando lande Task 11b, ese mismo serve sirve la historia y hace la ingesta SQLite con su ticker; (4) `api_port` pasa a ser atributo del proyecto, no del run — desaparece la carrera de `_active_run`. El serve es read-only y barato (lee archivos on-demand); dos procesos (run + serve) sobre `.orquestalite/` es exactamente el patrón ya soportado (`serveJSONFile` tolera writers concurrentes, `web/server.go:226-245`).

**D2. `RunKind.flow` como kind principal.** `POST /projects/{id}/runs` acepta `{kind: "flow", flow: "factory_fast_governed", inputs: {features_path: "features.md"}}` → argv `["flow", "run", name, "k=v"…]`. `run|factory|plan` quedan como kinds legacy con su mapeo argv correcto.

**D3. Config per-proyecto con round-trip sin pérdida.** Los stores operan sobre `<workspace>/team.json|flows.json` haciendo read-modify-write del JSON crudo (solo tocan las claves editadas; preservan todo lo desconocido, incluido `rate_limit_backoff`). Los modelos Pydantic de la API son *vistas*, nunca el formato de persistencia.

**D4. Webhooks centralizados en orquesta > N daemons `watch`.** Para multi-proyecto, un solo receptor `POST /webhooks/github` en orquesta que rutea a `RunSupervisor.launch(kind=flow, flow=pr_review|issue_fix)` escala mejor que supervisar un daemon de polling por proyecto. `orq-lite watch` queda para uso standalone (y como fallback sin webhook). Esto reusa los flows de orq-lite Fase 3 tal cual.

**D5. El chat centralizado es un agente con tools = la REST API de orquesta.** No inventar un "OPENCODE_SERVER_URL": el ChatService del backend llama a un provider LLM (Claude API o CLI de agente, decisión en el plan) con tool-use sobre las operaciones ya existentes (listar proyectos, lanzar run, toggle watch, leer estado, appendear feature). El chat queda thin-policy sobre la API (como dice el spec §10) y las conversaciones se persisten en DB.

---

## 5. Qué incorporar en orquesta-lite (propuestas para su plan)

Ordenadas por costo/beneficio; ninguna viola la constraint read-only del serve:

- **I1 — `GET /api/flows` en serve** *(extensión natural de Task 21)*: lista de flows con `description`, `inputs` (tipo+default) y roles requeridos + estado de preflight por rol. Es lo que la UI de orquesta necesita para renderizar el launcher de flows sin parsear `flows.json` por su cuenta (y elimina la clase de bug G3). Task 21 ya computa exactamente esto para `flow list`; exponerlo por HTTP es marginal.
- **I2 — `GET /api/doctor` en serve**: resultado del preflight (git, team.json, CLIs, credenciales) en JSON. orquesta lo muestra por proyecto y bloquea lanzamientos condenados a fallar. `commands.Doctor` ya existe; falta la vista JSON.
- **I3 — `GET /api/team` en serve**: el `team.json` efectivo (crudo) del workspace. Da a orquesta lectura de config sin acceso al filesystem (necesario cuando el executor sea Docker y el workspace viva en un volumen).
- **I4 — Token bearer opcional en serve** (`--auth-token` / env `ORQ_LITE_SERVE_TOKEN`): hoy serve no tiene auth (`web/server.go`); en cuanto el DockerExecutor mapee puertos fuera de loopback, cualquier proceso local lee el estado. Check de header en un middleware de 15 líneas; off por default.
- **I5 — run_id descubrible por el supervisor**: con Task 6, garantizar que el `run_start` sale también por el SSE inmediatamente (sale, porque va a run.log) **y** que `GET /api/runs?active=true` (Task 11b) expone el run en curso. Con eso orquesta correlaciona su `RunRow` con el `run_id` de orq-lite sin parsear stdout. Es solo un criterio de aceptación extra sobre 11b, no una tarea nueva.
- **I6 (futuro, v2) — `POST /api/trigger/{flow}` autenticado** (modo C del assessment de orq-lite §3): permitiría a orquesta disparar runs por HTTP sin supervisar procesos (ej. orq-lite corriendo en otra máquina). Requiere levantar la constraint read-only conscientemente; no es necesario mientras el executor sea local/docker en el mismo host. Mantener anotado, no implementar.

---

## 6. Veredicto

orquesta tiene el **diseño correcto ya especificado** (el spec de backend es sólido y las decisiones arquitectónicas — control plane sobre serves read-only, executor pluggable, Pydantic espejo de types.ts — son las correctas) y una UI completa, pero el estado real es **pre-alfa**: el camino crítico (lanzar un run y verlo vivo) está roto en el primer paso (G1), nada persiste el ciclo de vida (G2), y las dos superficies de edición de config corrompen los archivos que tocan (G3). Nada de esto es investigación: es terminar P1 con la corrección que el spec ya describe, alinear los schemas con los reales de orq-lite en vez de inventar paralelos, y sentarse encima de la Fase 1/3 del plan de orq-lite (query API, flows por defecto, watch→flows) en lugar de duplicarla.

La secuencia correcta: primero hacer reales los runs con serve-por-proyecto (D1/D2) y el wiring frontend de mutaciones; después config per-proyecto sin pérdida (D3) y eventos multi-proyecto; recién entonces historia/costo (consumiendo 11b), chat real (D5) y watchers/auth/docker.

Plan de implementación: `docs/superpowers/plans/2026-07-01-orquesta-product-readiness.md`.

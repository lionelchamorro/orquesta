# Orquesta production-ready: chat operativo, editor dual de flows, observabilidad

Fecha: 2026-07-10
Estado: aprobado en brainstorming (opción A — consolidar y pulir lo existente)

## Propósito

Convertir orquesta en el panel de control completo de orq-lite: desde el
browser se puede **pedir trabajo** (chat), **definir cómo se ejecuta** (editor
de flows) y **ver qué está pasando** (observabilidad), sin depender de la
terminal. Criterio de éxito global: levantar el contenedor all-in-one
(`deploy/`), entrar por el browser y completar el ciclo *pedir una tarea →
orq-lite la ejecuta → ver el progreso y el resultado*.

## Contexto y decisiones tomadas

- Target de despliegue: **contenedor all-in-one** (`deploy/docker-compose.yml`,
  supervisord con Next :3000, FastAPI :8000, opencode :4096, MCP :8765,
  orq-lite efímero por run). Uso personal/equipo chico detrás de un proxy.
- Chat consolidado sobre **opencode** (agente `orquesta` +
  tools MCP → FastAPI → orq-lite). El endpoint FastAPI `POST /chat`
  (Anthropic) queda como está, sin frontend — no se toca ni se elimina.
- Grafo del editor: **interactivo** (editar desde los nodos), no canvas
  drag & drop libre — el engine ejecuta los steps en orden de lista, las
  flechas se derivan, no se dibujan.
- Prioridades del usuario: observabilidad + funcionamiento/integración real
  con orq-lite. Auth multiusuario y CI/release quedan fuera.
- Síntoma actual reportado: la página `/dashboard/chat` "tira directamente un
  error" corriendo el contenedor all-in-one. Diagnóstico de causa raíz es la
  primera tarea de implementación.

## Sección 1 — Chat operativo sobre opencode

### 1a. Arreglo del crash

Reproducir el error en el contenedor (`docker compose up` + abrir
`/dashboard/chat`) y corregir la causa raíz. Aceptación: la página de chat
renderiza siempre, incluso con opencode o el API caídos; un backend ausente
muestra un banner claro ("opencode no está corriendo") con botón de reintento,
nunca el error boundary genérico.

### 1b. Streaming real

`GlobalChat` hoy hace `await client.session.prompt(...)` bloqueante. Cambio:
antes de enviar, suscribirse al stream SSE `GET /event` de opencode (vía el
proxy same-origin `/opencode` existente) filtrando por `sessionID`, y
renderizar incrementalmente:

- deltas de texto a medida que llegan;
- cada tool-call como chip inline **dentro** del mensaje, en el orden real de
  ejecución, con estado (ejecutando → completado/error). Los chips dejan de
  borrarse en cada turno.

El `session.prompt` sigue siendo el disparador del turno; el SSE es la fuente
de renderizado incremental. Si el SSE no está disponible, fallback al
comportamiento actual (respuesta completa al final).

### 1c. Historial persistente

- `sessionID` de opencode persistido en `localStorage`.
- Al montar, si hay sesión previa, recuperar mensajes con `session.messages()`
  y renderizarlos (incluyendo tool-calls pasados).
- Botón "nueva conversación" que descarta el `sessionID` guardado.
- Sin tablas nuevas: opencode ya persiste sesiones.

### 1d. Modelo configurable

El agente está clavado a `opencode/deepseek-v4-flash-free` en
`deploy/opencode.json`. El entrypoint del contenedor
(`deploy/orquesta-entrypoint.sh`) inyecta `ORQUESTA_CHAT_MODEL` (env var; el
modelo free actual queda como default) en la config del agente, para apuntar a
un modelo mejor para tool-use sin rebuild.

### 1e. Verificación end-to-end

En el contenedor: un turno de chat que registre un proyecto y lance un flow,
confirmando que el run aparece en el control plane (`GET /runs`).

## Sección 2 — Editor dual de flows (grafo + JSON)

### Estructura

La página de flows conserva lista lateral de flows y selector de proyecto. El
panel principal pasa a **tres pestañas** sobre un único estado React
(`FlowDefinition`, fuente de verdad):

1. **Grafo** (nueva, default) — `@xyflow/react` (React Flow).
2. **Formulario** — los forms por step actuales, se conservan.
3. **JSON** (nueva, editable) — CodeMirror 6.

**Save** sigue siendo el `PUT /projects/{id}/flows/{flow_id}` existente que
escribe `flows.json` (solo claves del engine: `{description, inputs, steps}`).
Sin cambios de backend.

### Pestaña Grafo

- Un nodo por step, en cadena vertical según orden de ejecución; flechas
  derivadas de la lista. Nodo muestra tipo + resumen (comando/agente/acción) y
  color por tipo de step.
- `loop` y `retry_until` como **contenedores** (subflows) con su `body`
  anidado adentro, recursivo. Esto destraba la edición de bodies anidados,
  hoy imposible desde la UI.
- Click en nodo → panel lateral de edición con los campos tipados del
  formulario actual (misma lógica de validación, p. ej. "exactamente uno de
  command/args").
- Acciones por nodo/contenedor: agregar step antes/después/dentro, eliminar,
  subir/bajar. Layout automático calculado; **no** se persisten coordenadas en
  `flows.json`.

### Pestaña JSON

- Editor CodeMirror con highlight del shape exacto del engine.
- Validación en vivo: JSON parseable + reglas de steps (front laxo; el back
  revalida con `validate_flow_steps` en el PUT y es la autoridad).
- Botón **Aplicar**: parsea, valida, actualiza el estado compartido; al volver
  al grafo se ve el cambio. JSON inválido → error inline con posición, no se
  aplica. Sin sync tecla-a-tecla.

### Errores

Los 422 del PUT se muestran con el detalle real de validación y señalan el
step ofensivo en el grafo.

## Sección 3 — Observabilidad e integración robusta

### 3a. Estado del sistema visible

- Endpoint server-side Next `/api/system-status`: chequea FastAPI (`/health`),
  opencode (`/config`), MCP (`:8765`) y conteo de runs activos del control
  plane.
- Tira de estado en el sidebar del dashboard: punto verde/rojo por servicio
  con tooltip, refresco ~30s.

### 3b. "Caído" distinto de "vacío"

`lib/orq-lite.ts` hoy degrada silenciosamente a `[]` cuando el control plane
no responde. Cambio: los fetchers distinguen *unreachable* de *vacío*; las
páginas muestran banner explícito ("control plane no disponible") con
reintento. Mismo patrón visual que el banner del chat (1a).

### 3c. Trazabilidad de runs lanzados por chat

El resultado de la tool MCP que lanza un run incluye `run_id`; el chip de
tool-call en el chat linkea a la vista del proyecto/run, donde ya existen live
events SSE e historial.

### 3d. Smoke test del contenedor

`deploy/smoke.sh`: levanta el compose, espera health de los procesos
supervisados, y verifica vía API: registrar proyecto de prueba, guardar un
flow, leer eventos SSE; opcionalmente (si hay credenciales) un turno de chat
con tool-call. Exit code ≠ 0 si algo falla. Es el criterio ejecutable de
"contenedor listo".

### 3e. Gates finales

- `pnpm typecheck && pnpm lint && pnpm test` en verde.
- Tests Python del API en verde.
- Docs de deploy actualizadas (env vars nuevas: `ORQUESTA_CHAT_MODEL`, y
  cualquier otra introducida).

## Dependencias nuevas (frontend)

- `@xyflow/react` (grafo).
- CodeMirror 6 (editor JSON; paquetes `@codemirror/*` o wrapper ligero).

## Fuera de alcance (explícito)

- Auth multiusuario / endurecimiento de login.
- Pipeline CI/release de la imagen docker.
- Canvas drag & drop libre estilo n8n.
- Unificación o eliminación del endpoint FastAPI `POST /chat`.
- Cambios al engine de orq-lite o a los schemas de `flows.json`.

## Criterios de aceptación (resumen ejecutable)

1. `/dashboard/chat` renderiza con backends caídos y muestra banner con causa.
2. Un pedido en el chat ("registrá X y lanzá el flow Y") produce un run real
   visible en el control plane, con streaming de texto y chips de tools en
   vivo, y link al run.
3. Recargar la página conserva la conversación.
4. Un flow con `loop` + body anidado se puede editar por completo desde el
   grafo; el mismo cambio hecho por JSON + Aplicar se refleja en el grafo; el
   Save produce en `flows.json` un diff limitado a lo editado.
5. La tira de estado refleja en ~30s la caída de opencode o del API; las
   páginas distinguen "vacío" de "caído".
6. `deploy/smoke.sh` pasa de punta a punta en el contenedor.

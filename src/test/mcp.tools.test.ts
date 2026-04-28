import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentPool } from "../agents/pool";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { AskRouter } from "../daemon/ask-router";
import { createToolHandlers, toolDefinitions } from "../mcp/tools";

const savePlannerAgent = (store: PlanStore, id = "agent-1") =>
  store.saveAgent({
    id,
    role: "planner",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });

test("emit_tasks creates tasks", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-tools-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "approved", created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  const store = new PlanStore(root);
  const bus = new Bus();
  const pool = new AgentPool(root, store, bus);
  const askRouter = new AskRouter(store, pool, bus);
  await savePlannerAgent(store);
  const tools = createToolHandlers({ store, bus, askRouter, agentPool: pool });
  await tools.emit_tasks("agent-1", { tasks: [{ title: "A", depends_on: [] }] });
  expect((await store.loadTasks()).length).toBe(1);
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

test("emit_tasks replaces previous iteration tasks by default", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-tools-replace-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "drafting", created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  const store = new PlanStore(root);
  const bus = new Bus();
  const pool = new AgentPool(root, store, bus);
  const askRouter = new AskRouter(store, pool, bus);
  await savePlannerAgent(store);
  const tools = createToolHandlers({ store, bus, askRouter, agentPool: pool });
  await tools.emit_tasks("agent-1", { tasks: [{ title: "A", depends_on: [] }, { title: "B", depends_on: [] }] });
  expect((await store.loadTasks()).length).toBe(2);
  await tools.emit_tasks("agent-1", { tasks: [{ title: "C", depends_on: [] }] });
  const tasks = await store.loadTasks();
  expect(tasks.length).toBe(1);
  expect(tasks[0].title).toBe("C");
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

test("emit_tasks with replace:false appends", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-tools-append-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "drafting", created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  const store = new PlanStore(root);
  const bus = new Bus();
  const pool = new AgentPool(root, store, bus);
  const askRouter = new AskRouter(store, pool, bus);
  await savePlannerAgent(store);
  const tools = createToolHandlers({ store, bus, askRouter, agentPool: pool });
  await tools.emit_tasks("agent-1", { tasks: [{ title: "A", depends_on: [] }] });
  await tools.emit_tasks("agent-1", { replace: false, tasks: [{ title: "B", depends_on: [] }] });
  expect((await store.loadTasks()).length).toBe(2);
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

test("emit_tasks rejects unauthorized roles and validator replacement", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-tools-authz-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "running", created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  const store = new PlanStore(root);
  const bus = new Bus();
  const pool = new AgentPool(root, store, bus);
  const askRouter = new AskRouter(store, pool, bus);
  await store.saveAgent({
    id: "agent-coder",
    role: "coder",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });
  await store.saveAgent({
    id: "agent-qa",
    role: "qa",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });
  const tools = createToolHandlers({ store, bus, askRouter, agentPool: pool });

  await expect(tools.emit_tasks("agent-coder", { tasks: [{ title: "A" }] })).rejects.toThrow("not allowed");
  await expect(tools.emit_tasks("agent-qa", { replace: true, tasks: [{ title: "A" }] })).rejects.toThrow("replace is only allowed");
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

test("MCP tool schemas document required arguments", () => {
  const byName = new Map(toolDefinitions.map((tool) => [tool.name, tool.inputSchema]));

  expect(byName.get("ask_user")?.required).toContain("question");
  expect(byName.get("ask_user")?.properties).toHaveProperty("question");
  expect(byName.get("report_progress")?.required).toEqual(["status", "note"]);
  expect(byName.get("report_progress")?.properties).toHaveProperty("status");
  expect(byName.get("report_progress")?.properties).toHaveProperty("note");
  expect(byName.get("report_complete")?.required).toEqual(["summary"]);
  expect(byName.get("report_complete")?.properties).toHaveProperty("summary");
});

test("report_complete for unbound agent emits agent_completed", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-tools-agent-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "approved", created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  const store = new PlanStore(root);
  const bus = new Bus();
  const killed: string[] = [];
  const pool = { kill(agentId: string) { killed.push(agentId); }, write() {} } as never;
  const askRouter = new AskRouter(store, pool, bus);
  await store.saveAgent({
    id: "agent-1",
    role: "planner",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });
  const seen: string[] = [];
  bus.subscribe("agent-1", (event) => {
    if (event.payload.type === "agent_completed") seen.push(event.payload.summary);
  });
  const tools = createToolHandlers({ store, bus, askRouter, agentPool: pool });
  await tools.report_complete("agent-1", { summary: "planned" });
  expect(seen).toEqual(["planned"]);
  expect(killed).toEqual(["agent-1"]);
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

test("report_complete for bound subtask does not emit agent_completed", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-tools-bound-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "approved", created_at: "a", updated_at: "a", task_count: 1, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  const store = new PlanStore(root);
  const bus = new Bus();
  const pool = { kill() {}, write() {} } as never;
  const askRouter = new AskRouter(store, pool, bus);
  await store.saveTask({
    id: "task-1",
    title: "Task",
    status: "running",
    depends_on: [],
    iteration: 1,
    created_at: "a",
    updated_at: "a",
    attempt_count: 0,
    subtasks: ["sub-1"],
  });
  await store.saveSubtask({
    id: "sub-1",
    taskId: "task-1",
    type: "code",
    role: "coder",
    status: "running",
    prompt: "x",
    depends_on: [],
    created_at: "a",
  });
  await store.saveAgent({
    id: "agent-2",
    role: "coder",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
    bound_subtask: "sub-1",
  });
  let seen = false;
  bus.subscribe("agent-2", (event) => {
    if (event.payload.type === "agent_completed") seen = true;
  });
  const tools = createToolHandlers({ store, bus, askRouter, agentPool: pool });
  await tools.report_complete("agent-2", { summary: "done" });
  expect(seen).toBeFalse();
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

test("report_progress failed for unbound agent emits agent_failed and kills agent", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-tools-failed-agent-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "x", status: "approved", created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 2,
  }));
  const store = new PlanStore(root);
  const bus = new Bus();
  const killed: string[] = [];
  const pool = { kill(agentId: string) { killed.push(agentId); }, write() {} } as never;
  const askRouter = new AskRouter(store, pool, bus);
  await store.saveAgent({
    id: "agent-3",
    role: "pm",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });
  const seen: string[] = [];
  bus.subscribe("agent-3", (event) => {
    if (event.payload.type === "agent_failed") seen.push(event.payload.reason);
  });
  const tools = createToolHandlers({ store, bus, askRouter, agentPool: pool });
  await tools.report_progress("agent-3", { status: "failed", note: "validator crashed" });
  expect(seen).toEqual(["validator crashed"]);
  expect(killed).toEqual(["agent-3"]);
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

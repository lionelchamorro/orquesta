import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import type { Agent, Config, Role, TeamMember } from "../core/types";
import { IterationManager } from "../daemon/iteration-manager";

const config: Config = {
  dependencies: "strict",
  concurrency: { workers: 1, max: 1 },
  review: { enabled: true, maxIterations: 1 },
  work: { maxAttemptsPerTask: 1, maxWaves: 1, maxIterations: 1, maxQuotaWaitMs: 7_200_000 },
  git: { enabled: false, baseBranch: "main", autoCommit: false, removeWorktreeOnArchive: false },
  team: [
    { role: "pm", cli: "claude", model: "pm" },
    { role: "architect", cli: "claude", model: "architect" },
    { role: "coder", cli: "codex", model: "m" },
  ],
};

test("ensureConsultantsLive spawns PM and architect for current iteration", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-consultants-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1", prd: "(prompt)", prompt: "goal", status: "running", created_at: "a", updated_at: "a", task_count: 1, completed_count: 0, current_iteration: 1, max_iterations: 2,
  });
  await store.saveIteration({
    id: "iter-1", number: 1, runId: "run-1", trigger: "initial", phase: "executing", started_at: "a", task_ids: ["task-1"],
  });
  const spawned: Role[] = [];
  const pool = {
    async getConsultant() { return null; },
    async spawnConsultant(role: "pm" | "architect", member: TeamMember, context: { iterationId: string; prompt: string }) {
      spawned.push(role);
      const agent: Agent = {
        id: `agent-${role}`,
        role,
        cli: member.cli,
        model: member.model,
        status: "live",
        session_cwd: ".",
        bound_iteration: context.iterationId,
      };
      await store.saveAgent(agent);
      return agent;
    },
    waitForExit() { return new Promise<number>(() => {}); },
    kill() {},
    write() {},
  };
  const manager = new IterationManager(store, pool as never, new Bus(), config);

  expect(await manager.ensureConsultantsLive()).toBe(true);
  expect(spawned).toEqual(["pm", "architect"]);
  expect((await store.loadAgents()).map((agent) => agent.bound_iteration)).toEqual(["iter-1", "iter-1"]);
  rmSync(root, { recursive: true, force: true });
});

test("ensureConsultantsLive respawns consultants while validating and keeps workers blocked", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-consultants-validating-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1", prd: "(prompt)", prompt: "goal", status: "running", created_at: "a", updated_at: "a", task_count: 1, completed_count: 0, current_iteration: 2, max_iterations: 3,
  });
  await store.saveIteration({
    id: "iter-2", number: 2, runId: "run-1", trigger: "architect_replan", phase: "validating", started_at: "a", task_ids: [], summary: "task-1: done",
  });
  const spawned: Role[] = [];
  const pool = {
    async getConsultant() { return null; },
    async spawnConsultant(role: "pm" | "architect", member: TeamMember, context: { iterationId: string; prompt: string }) {
      spawned.push(role);
      const agent: Agent = {
        id: `agent-${role}`,
        role,
        cli: member.cli,
        model: member.model,
        status: "live",
        session_cwd: ".",
        bound_iteration: context.iterationId,
      };
      await store.saveAgent(agent);
      return agent;
    },
    waitForExit() { return new Promise<number>(() => {}); },
    kill() {},
    write() {},
  };
  const manager = new IterationManager(store, pool as never, new Bus(), config);

  expect(await manager.ensureConsultantsLive()).toBe(false);
  expect(spawned).toEqual(["pm", "architect"]);
  expect((await store.loadAgents()).map((agent) => agent.bound_iteration)).toEqual(["iter-2", "iter-2"]);
  rmSync(root, { recursive: true, force: true });
});

test("onWaveEmpty kills only consultants bound to the closing iteration", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-consultants-close-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1", prd: "(prompt)", prompt: "goal", status: "running", created_at: "a", updated_at: "a", task_count: 1, completed_count: 1, current_iteration: 1, max_iterations: 2,
  });
  await store.saveTask({
    id: "task-1", title: "Done", status: "done", depends_on: [], iteration: 1, created_at: "a", updated_at: "a", attempt_count: 0, subtasks: [],
  });
  await store.saveIteration({
    id: "iter-1", number: 1, runId: "run-1", trigger: "initial", phase: "executing", started_at: "a", task_ids: ["task-1"],
  });
  await store.saveAgent({ id: "agent-pm-current", role: "pm", cli: "claude", model: "m", status: "live", session_cwd: ".", bound_iteration: "iter-2" });
  await store.saveAgent({ id: "agent-pm-other", role: "pm", cli: "claude", model: "m", status: "live", session_cwd: ".", bound_iteration: "iter-other" });
  const killed: string[] = [];
  const pool = {
    async spawn(role: Role) {
      const agent: Agent = { id: `validator-${role}`, role, cli: "claude", model: "m", status: "live", session_cwd: "." };
      await store.saveAgent(agent);
      setTimeout(() => bus.publish({ tags: [agent.id], payload: { type: "agent_completed", agentId: agent.id, summary: "ok" } }), 1);
      return agent;
    },
    waitForExit() { return new Promise<number>(() => {}); },
    kill(agentId: string) { killed.push(agentId); },
    write(agentId: string) {
      setTimeout(() => bus.publish({ tags: [agentId], payload: { type: "agent_completed", agentId, summary: "ok" } }), 1);
    },
  };
  const bus = new Bus();
  const manager = new IterationManager(store, pool as never, bus, config);

  await manager.onWaveEmpty();

  expect(killed).toContain("agent-pm-current");
  expect(killed).not.toContain("agent-pm-other");
  rmSync(root, { recursive: true, force: true });
});

test("onWaveEmpty resumes an unfinished validating iteration instead of creating a new one", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-consultants-resume-validation-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1", prd: "(prompt)", prompt: "goal", status: "running", created_at: "a", updated_at: "a", task_count: 1, completed_count: 1, current_iteration: 2, max_iterations: 3,
  });
  await store.saveIteration({
    id: "iter-1", number: 1, runId: "run-1", trigger: "initial", phase: "executing", started_at: "a", ended_at: "b", task_ids: ["task-1"],
  });
  await store.saveIteration({
    id: "iter-2", number: 2, runId: "run-1", trigger: "architect_replan", phase: "validating", started_at: "c", task_ids: [], summary: "task-1: done",
  });
  const bus = new Bus();
  const pool = {
    async spawn(role: Role) {
      const agent: Agent = { id: `validator-${role}`, role, cli: "claude", model: "m", status: "live", session_cwd: "." };
      await store.saveAgent(agent);
      setTimeout(() => bus.publish({ tags: [agent.id], payload: { type: "agent_completed", agentId: agent.id, summary: "ok" } }), 1);
      return agent;
    },
    waitForExit() { return new Promise<number>(() => {}); },
    kill() {},
    write(agentId: string) {
      setTimeout(() => bus.publish({ tags: [agentId], payload: { type: "agent_completed", agentId, summary: "ok" } }), 1);
    },
  };
  const manager = new IterationManager(store, pool as never, bus, config);

  await manager.onWaveEmpty();

  const iterations = await store.loadIterations();
  expect(iterations.map((iteration) => iteration.id)).toEqual(["iter-1", "iter-2"]);
  expect(iterations[1].ended_at).toBeString();
  rmSync(root, { recursive: true, force: true });
});

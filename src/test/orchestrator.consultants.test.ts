import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlanStore } from "../core/plan-store";
import type { Config } from "../core/types";
import { Orchestrator } from "../daemon/orchestrator";

test("orchestrator blocks worker dispatch until consultants are live", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-orch-consultants-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1", prd: "(prompt)", prompt: "goal", status: "running", created_at: "a", updated_at: "a", task_count: 1, completed_count: 0, current_iteration: 1, max_iterations: 2,
  });
  await store.saveIteration({ id: "iter-1", number: 1, runId: "run-1", trigger: "initial", phase: "executing", started_at: "a", task_ids: ["task-1"] });
  await store.saveTask({
    id: "task-1", title: "Task", status: "pending", depends_on: [], iteration: 1, created_at: "a", updated_at: "a", attempt_count: 0, subtasks: [],
  });
  const config: Config = {
    dependencies: "strict",
    concurrency: { workers: 1, max: 1 },
    review: { enabled: true, maxIterations: 1 },
    work: { maxAttemptsPerTask: 1, maxWaves: 1, maxIterations: 1, maxQuotaWaitMs: 7_200_000 },
    git: { enabled: false, baseBranch: "main", autoCommit: false, removeWorktreeOnArchive: false },
    team: [{ role: "coder", cli: "codex", model: "m" }],
  };
  let dispatched = false;
  const pipeline = { async run() { dispatched = true; } };
  const iterations = { isRunning: () => false, ensureConsultantsLive: async () => false, onWaveEmpty: async () => {} };
  const orchestrator = new Orchestrator(store, pipeline as never, iterations as never, config);

  await orchestrator.tick();

  expect(dispatched).toBe(false);
  rmSync(root, { recursive: true, force: true });
});

test("orchestrator resumes a validating iteration at wave boundary", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-orch-validating-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.savePlan({
    runId: "run-1", prd: "(prompt)", prompt: "goal", status: "running", created_at: "a", updated_at: "a", task_count: 1, completed_count: 1, current_iteration: 2, max_iterations: 3,
  });
  await store.saveIteration({ id: "iter-2", number: 2, runId: "run-1", trigger: "architect_replan", phase: "validating", started_at: "a", task_ids: [], summary: "task-1: done" });
  await store.saveTask({
    id: "task-1", title: "Task", status: "done", depends_on: [], iteration: 1, created_at: "a", updated_at: "a", attempt_count: 0, subtasks: [],
  });
  const config: Config = {
    dependencies: "strict",
    concurrency: { workers: 1, max: 1 },
    review: { enabled: true, maxIterations: 1 },
    work: { maxAttemptsPerTask: 1, maxWaves: 1, maxIterations: 1, maxQuotaWaitMs: 7_200_000 },
    git: { enabled: false, baseBranch: "main", autoCommit: false, removeWorktreeOnArchive: false },
    team: [{ role: "coder", cli: "codex", model: "m" }],
  };
  let dispatched = false;
  let resumedValidation = false;
  const pipeline = { async run() { dispatched = true; } };
  const iterations = {
    isRunning: () => false,
    ensureConsultantsLive: async () => false,
    onWaveEmpty: async () => { resumedValidation = true; },
  };
  const orchestrator = new Orchestrator(store, pipeline as never, iterations as never, config);

  await orchestrator.tick();

  expect(dispatched).toBe(false);
  expect(resumedValidation).toBe(true);
  rmSync(root, { recursive: true, force: true });
});

import { mkdirSync, rmSync } from "node:fs";
import { z } from "zod";
import { newRunId, nextIterationId } from "../core/ids";
import type { PlanStore } from "../core/plan-store";
import { RunSubmissionSchema, TaskSchema } from "../core/schemas";
import type { Iteration, Plan, Task } from "../core/types";

export type RunSubmission = z.input<typeof RunSubmissionSchema>;

export type RunIngestError =
  | { code: "invalid_payload"; message: string; details?: unknown }
  | { code: "run_in_progress"; message: string }
  | { code: "duplicate_task_id"; message: string }
  | { code: "missing_dependency"; message: string }
  | { code: "cycle_detected"; message: string };

export type RunIngestResult = { ok: true; runId: string } | { ok: false; error: RunIngestError };

const clearPreviousRunFiles = (store: PlanStore) => {
  for (const relative of ["tasks", "subtasks", "iterations", "agents", "sessions", "worktrees", "asks"]) {
    rmSync(store.crewPath(relative), { recursive: true, force: true });
    mkdirSync(store.crewPath(relative), { recursive: true });
  }
};

const buildTask = (input: z.infer<typeof RunSubmissionSchema>["tasks"][number], now: string): Task =>
  TaskSchema.parse({
    id: input.id,
    title: input.title,
    description: input.description,
    status: "pending",
    depends_on: input.depends_on,
    iteration: 1,
    created_at: now,
    updated_at: now,
    attempt_count: 0,
    subtasks: [],
  });

export const ingestRun = async (store: PlanStore, raw: unknown): Promise<RunIngestResult> => {
  const parsed = RunSubmissionSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_payload", message: parsed.error.message, details: parsed.error.flatten() } };
  }
  const payload = parsed.data;

  const existingPlan = await store.loadPlan().catch(() => null);
  if (existingPlan && existingPlan.status === "running") {
    return { ok: false, error: { code: "run_in_progress", message: `cannot start a run while current run is ${existingPlan.status}` } };
  }

  const seen = new Set<string>();
  for (const task of payload.tasks) {
    if (seen.has(task.id)) {
      return { ok: false, error: { code: "duplicate_task_id", message: `Duplicate task id: ${task.id}` } };
    }
    seen.add(task.id);
  }

  for (const task of payload.tasks) {
    for (const dep of task.depends_on) {
      if (!seen.has(dep)) {
        return { ok: false, error: { code: "missing_dependency", message: `Task ${task.id} depends on missing task ${dep}` } };
      }
    }
  }

  const now = new Date().toISOString();
  const tasks = payload.tasks.map((task) => buildTask(task, now));
  try {
    await store.validateTaskGraph(tasks);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid task graph";
    if (message.startsWith("Task dependency cycle detected")) {
      return { ok: false, error: { code: "cycle_detected", message } };
    }
    if (message.startsWith("Task ") && message.includes("depends on missing task")) {
      return { ok: false, error: { code: "missing_dependency", message } };
    }
    return { ok: false, error: { code: "invalid_payload", message } };
  }

  clearPreviousRunFiles(store);

  const runId = payload.runId ?? newRunId();
  const plan: Plan = {
    runId,
    prd: payload.prd,
    prompt: payload.prompt,
    status: "running",
    created_at: now,
    updated_at: now,
    task_count: tasks.length,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: payload.max_iterations ?? 2,
  };
  await store.savePlan(plan);
  for (const task of tasks) {
    await store.saveTask(task);
  }
  const iterationId = nextIterationId([]);
  const iteration: Iteration = {
    id: iterationId,
    number: 1,
    runId,
    trigger: "initial",
    phase: "executing",
    started_at: now,
    task_ids: tasks.map((task) => task.id),
  };
  await store.saveIteration(iteration);
  await Bun.write(store.crewPath("run.source"), "ingested\n");

  return { ok: true, runId };
};

export const readRunSource = async (store: PlanStore): Promise<"ingested" | "imported" | "planner" | "unknown"> => {
  const file = Bun.file(store.crewPath("run.source"));
  if (!(await file.exists())) {
    const plan = await store.loadPlan().catch(() => null);
    if (!plan || !plan.runId || plan.runId === "run-1") return "unknown";
    return "planner";
  }
  const text = (await file.text()).trim();
  if (text === "ingested") return "ingested";
  return text === "imported" ? "imported" : "planner";
};

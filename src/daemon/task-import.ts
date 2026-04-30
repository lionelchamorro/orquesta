import { mkdirSync, rmSync } from "node:fs";
import { z } from "zod";
import { newRunId, nextIterationId } from "../core/ids";
import type { PlanStore } from "../core/plan-store";
import { TaskSchema } from "../core/schemas";
import type { Iteration, Plan, Task } from "../core/types";

const TaskInputSchema = z
  .object({
    id: z.string().min(1),
    title: z.string(),
    description: z.string().optional(),
    depends_on: z.array(z.string()).default([]),
    iteration: z.number().int().positive().default(1),
    parent_task_id: z.string().optional(),
    subtasks: z.array(z.string()).default([]),
  })
  .strict();

export const ImportPayloadSchema = z
  .object({
    prompt: z.string().default(""),
    runId: z.string().min(1).optional(),
    prd: z.string().default("(prompt)"),
    tasks: z.array(TaskInputSchema).min(1),
  })
  .strict();

export type ImportPayload = z.input<typeof ImportPayloadSchema>;

export type ImportError =
  | { code: "invalid_payload"; message: string; details?: unknown }
  | { code: "run_in_progress"; message: string }
  | { code: "missing_dependency"; message: string }
  | { code: "cycle_detected"; message: string };

export type ImportResult = { ok: true; runId: string } | { ok: false; error: ImportError };

const clearPreviousRunFiles = (store: PlanStore) => {
  for (const relative of ["tasks", "subtasks", "iterations", "agents", "sessions", "worktrees", "asks"]) {
    rmSync(store.crewPath(relative), { recursive: true, force: true });
    mkdirSync(store.crewPath(relative), { recursive: true });
  }
};

const buildTask = (input: z.infer<typeof TaskInputSchema>, now: string): Task =>
  TaskSchema.parse({
    id: input.id,
    title: input.title,
    description: input.description,
    status: "pending",
    depends_on: input.depends_on,
    iteration: input.iteration,
    parent_task_id: input.parent_task_id,
    created_at: now,
    updated_at: now,
    attempt_count: 0,
    subtasks: input.subtasks,
  });

export const importTasks = async (store: PlanStore, raw: unknown): Promise<ImportResult> => {
  const parsed = ImportPayloadSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: { code: "invalid_payload", message: parsed.error.message, details: parsed.error.flatten() } };
  }
  const payload = parsed.data;

  const existingPlan = await store.loadPlan().catch(() => null);
  if (existingPlan && (existingPlan.status === "running" || existingPlan.status === "drafting")) {
    return { ok: false, error: { code: "run_in_progress", message: `cannot import while a run is ${existingPlan.status}` } };
  }

  const ids = new Set(payload.tasks.map((task) => task.id));
  for (const task of payload.tasks) {
    for (const dep of task.depends_on) {
      if (!ids.has(dep)) {
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
    status: "approved",
    created_at: now,
    updated_at: now,
    task_count: tasks.length,
    completed_count: 0,
    current_iteration: 1,
    max_iterations: 2,
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
    started_at: now,
    task_ids: tasks.map((task) => task.id),
  };
  await store.saveIteration(iteration);
  await Bun.write(store.crewPath("run.source"), "imported\n");

  return { ok: true, runId };
};

export const readRunSource = async (store: PlanStore): Promise<"imported" | "planner" | "unknown"> => {
  const file = Bun.file(store.crewPath("run.source"));
  if (!(await file.exists())) {
    const plan = await store.loadPlan().catch(() => null);
    if (!plan || !plan.runId || plan.runId === "run-1") return "unknown";
    return "planner";
  }
  const text = (await file.text()).trim();
  return text === "imported" ? "imported" : "planner";
};

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync } from "node:fs";
import path from "node:path";
import type { PlanStore } from "../core/plan-store";

const REMOVED_PLAN_STATUSES = new Set(["drafting", "awaiting_approval", "approved"]);
const VALID_TASK_STATUSES = new Set(["pending", "ready", "running", "blocked", "done", "failed", "failed_quota", "cancelled"]);

const readJson = (filePath: string): Record<string, unknown> | null => {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
};

export const checkCrewCompatibility = (store: PlanStore): string[] => {
  const issues: string[] = [];
  const plan = readJson(store.crewPath("plan.json"));
  if (typeof plan?.status === "string" && REMOVED_PLAN_STATUSES.has(plan.status)) {
    issues.push(`plan status ${plan.status} is no longer supported`);
  }

  const agentsDir = store.crewPath("agents");
  if (existsSync(agentsDir)) {
    for (const name of readdirSync(agentsDir)) {
      if (!name.endsWith(".json")) continue;
      const agent = readJson(path.join(agentsDir, name));
      if (agent?.role === "planner") issues.push(`planner agent found in agents/${name}`);
    }
  }

  const tasksDir = store.crewPath("tasks");
  if (existsSync(tasksDir)) {
    for (const name of readdirSync(tasksDir)) {
      if (!name.endsWith(".json")) continue;
      const task = readJson(path.join(tasksDir, name));
      if (typeof task?.status === "string" && !VALID_TASK_STATUSES.has(task.status)) {
        issues.push(`task ${name} has unknown status ${task.status}`);
      }
    }
  }

  return issues;
};

export const migrateCrew = (store: PlanStore, now = new Date()): string => {
  const crewDir = store.crewPath();
  mkdirSync(crewDir, { recursive: true });
  const plan = readJson(store.crewPath("plan.json"));
  const runId = typeof plan?.runId === "string" && plan.runId.trim() ? plan.runId : "run";
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const archiveRoot = store.crewPath("archive");
  const destination = path.join(archiveRoot, `${runId}-migrated-${stamp}`);
  mkdirSync(destination, { recursive: true });

  for (const name of readdirSync(crewDir)) {
    if (name === "archive") continue;
    renameSync(path.join(crewDir, name), path.join(destination, name));
  }

  return destination;
};

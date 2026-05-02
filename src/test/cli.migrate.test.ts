import { expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlanStore } from "../core/plan-store";
import { checkCrewCompatibility, migrateCrew } from "../daemon/compatibility";

const tmpRoot = (label: string) => {
  const root = path.join(os.tmpdir(), `orq-migrate-${label}-${crypto.randomUUID()}`);
  mkdirSync(path.join(root, ".orquesta", "crew", "agents"), { recursive: true });
  mkdirSync(path.join(root, ".orquesta", "crew", "tasks"), { recursive: true });
  return root;
};

test("compatibility check flags removed planner-era state", async () => {
  const root = tmpRoot("check");
  const store = new PlanStore(root);
  await Bun.write(store.crewPath("plan.json"), JSON.stringify({
    runId: "run-1",
    status: "awaiting_approval",
  }));
  await Bun.write(store.crewPath("agents", "agent-1.json"), JSON.stringify({ id: "agent-1", role: "planner" }));
  await Bun.write(store.crewPath("tasks", "task-1.json"), JSON.stringify({ id: "task-1", status: "mystery" }));

  expect(checkCrewCompatibility(store)).toEqual([
    "plan status awaiting_approval is no longer supported",
    "planner agent found in agents/agent-1.json",
    "task task-1.json has unknown status mystery",
  ]);

  rmSync(root, { recursive: true, force: true });
});

test("migrateCrew archives current crew contents and leaves fresh crew directory", async () => {
  const root = tmpRoot("archive");
  const store = new PlanStore(root);
  await Bun.write(store.crewPath("plan.json"), JSON.stringify({ runId: "run-1", status: "awaiting_approval" }));
  await Bun.write(store.crewPath("tasks", "task-1.json"), JSON.stringify({ id: "task-1", status: "pending" }));

  const archivePath = migrateCrew(store, new Date("2026-05-02T00:00:00.000Z"));

  expect(archivePath.endsWith(path.join("archive", "run-1-migrated-2026-05-02T00-00-00-000Z"))).toBe(true);
  expect(existsSync(path.join(archivePath, "plan.json"))).toBe(true);
  expect(existsSync(path.join(archivePath, "tasks", "task-1.json"))).toBe(true);
  expect(existsSync(store.crewPath("plan.json"))).toBe(false);
  expect(checkCrewCompatibility(store)).toEqual([]);

  rmSync(root, { recursive: true, force: true });
});

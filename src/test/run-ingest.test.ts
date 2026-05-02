import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlanStore } from "../core/plan-store";
import { ingestRun } from "../daemon/run-ingest";

const tmpRoot = (label: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), `orq-run-ingest-${label}-`));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  return root;
};

test("ingestRun starts a running plan with a validated task DAG", async () => {
  const root = tmpRoot("happy");
  const store = new PlanStore(root);

  const result = await ingestRun(store, {
    prompt: "ship it",
    max_iterations: 3,
    tasks: [
      { id: "task-a", title: "first" },
      { id: "task-b", title: "second", depends_on: ["task-a"] },
    ],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  const plan = await store.loadPlan();
  expect(plan.status).toBe("running");
  expect(plan.prompt).toBe("ship it");
  expect(plan.max_iterations).toBe(3);
  expect(plan.task_count).toBe(2);
  expect((await store.loadTasks()).map((task) => task.id)).toEqual(["task-a", "task-b"]);
  expect((await store.loadIterations())[0].task_ids).toEqual(["task-a", "task-b"]);

  rmSync(root, { recursive: true, force: true });
});

test("ingestRun rejects duplicate task ids without writing partial state", async () => {
  const root = tmpRoot("duplicate");
  const store = new PlanStore(root);

  const result = await ingestRun(store, {
    prompt: "x",
    tasks: [
      { id: "task-a", title: "first" },
      { id: "task-a", title: "duplicate" },
    ],
  });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("unreachable");
  expect(result.error.code).toBe("duplicate_task_id");
  expect(await store.loadTasks()).toEqual([]);

  rmSync(root, { recursive: true, force: true });
});

test("ingestRun rejects invalid ids, dangling dependencies, and cycles", async () => {
  const invalidRoot = tmpRoot("invalid-id");
  const invalid = await ingestRun(new PlanStore(invalidRoot), { tasks: [{ id: "Task 1", title: "bad" }] });
  expect(invalid.ok).toBe(false);
  if (!invalid.ok) expect(invalid.error.code).toBe("invalid_payload");
  rmSync(invalidRoot, { recursive: true, force: true });

  const missingRoot = tmpRoot("missing");
  const missing = await ingestRun(new PlanStore(missingRoot), {
    tasks: [{ id: "task-a", title: "a", depends_on: ["task-z"] }],
  });
  expect(missing.ok).toBe(false);
  if (!missing.ok) expect(missing.error.code).toBe("missing_dependency");
  rmSync(missingRoot, { recursive: true, force: true });

  const cycleRoot = tmpRoot("cycle");
  const cycle = await ingestRun(new PlanStore(cycleRoot), {
    tasks: [
      { id: "task-a", title: "a", depends_on: ["task-b"] },
      { id: "task-b", title: "b", depends_on: ["task-a"] },
    ],
  });
  expect(cycle.ok).toBe(false);
  if (!cycle.ok) expect(cycle.error.code).toBe("cycle_detected");
  rmSync(cycleRoot, { recursive: true, force: true });
});

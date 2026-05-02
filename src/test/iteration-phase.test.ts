import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PlanStore } from "../core/plan-store";

test("iterations default to executing phase when loading legacy records", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-iteration-phase-"));
  mkdirSync(path.join(root, ".orquesta", "crew", "iterations"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "iterations", "iter-1.json"), JSON.stringify({
    id: "iter-1",
    number: 1,
    runId: "run-1",
    trigger: "initial",
    started_at: "a",
    task_ids: [],
  }));

  const [iteration] = await new PlanStore(root).loadIterations();
  expect(iteration.phase).toBe("executing");
  rmSync(root, { recursive: true, force: true });
});

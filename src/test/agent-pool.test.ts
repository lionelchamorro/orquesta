import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentPool } from "../agents/pool";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";

const templatesDir = path.join(import.meta.dir, "..", "..", "templates");

test("agent pool separates general agent output from subtask output", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-agent-pool-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  const bus = new Bus();
  const seen: string[] = [];
  bus.subscribe(() => true, (event) => {
    seen.push(event.payload.type);
    if (event.payload.type === "subtask_output") {
      expect(event.payload.subtaskId).not.toBe("");
    }
  });

  const pool = new AgentPool(root, store, bus, { templatesDir });
  const agent = await pool.spawn("planner", "claude", "m", "", {
    command: ["bash", "-lc", "printf 'hello\\nworld\\n'"],
  });
  await pool.waitForExit(agent.id);
  await new Promise((resolve) => setTimeout(resolve, 10));

  const saved = await store.loadAgent(agent.id);
  expect(seen).toContain("agent_output");
  expect(seen).not.toContain("subtask_output");
  expect(saved?.status).toBe("dead");
  expect(saved?.finished_at).toBeString();
  expect(saved?.last_event_at).toBeString();
  rmSync(root, { recursive: true, force: true });
});

import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AgentPool } from "../agents/pool";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import type { TeamMember } from "../core/types";

const member: TeamMember = {
  role: "coder",
  cli: "claude",
  model: "opus",
  fallbacks: [
    { cli: "claude", model: "sonnet" },
    { cli: "codex", model: "gpt-5.5" },
  ],
};

test("nextAvailable walks fallback chain and respects expiry", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-pool-fallback-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const pool = new AgentPool(root, new PlanStore(root), new Bus());

  expect(pool.nextAvailable(member, new Date("2026-05-02T00:00:00.000Z"))).toEqual({ cli: "claude", model: "opus", command: undefined });

  pool.markUnavailable("claude", "opus", "2026-05-02T01:00:00.000Z");
  expect(pool.nextAvailable(member, new Date("2026-05-02T00:00:00.000Z"))).toEqual({ cli: "claude", model: "sonnet" });

  pool.markUnavailable("claude", "sonnet", "2026-05-02T01:00:00.000Z");
  pool.markUnavailable("codex", "gpt-5.5", "2026-05-02T01:00:00.000Z");
  expect(pool.nextAvailable(member, new Date("2026-05-02T00:00:00.000Z"))).toBeNull();
  expect(pool.nextAvailable(member, new Date("2026-05-02T01:00:01.000Z"))).toEqual({ cli: "claude", model: "opus", command: undefined });

  rmSync(root, { recursive: true, force: true });
});

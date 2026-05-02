import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { AskRouter } from "../daemon/ask-router";
import { createToolHandlers } from "../mcp/tools";

test("answer_ask requires responder role to match target_role", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-answer-ask-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.saveAgent({ id: "agent-pm", role: "pm", cli: "claude", model: "m", status: "live", session_cwd: "." });
  await store.saveAgent({ id: "agent-architect", role: "architect", cli: "claude", model: "m", status: "live", session_cwd: "." });
  await store.savePendingAsk({
    id: "ask-1",
    fromAgent: "worker-1",
    question: "cache?",
    target_role: "architect",
    status: "pending",
    created_at: "a",
    updated_at: "a",
  });
  const bus = new Bus();
  const router = new AskRouter(store, { write() {} } as never, bus);
  const tools = createToolHandlers({ store, bus, askRouter: router, agentPool: { kill() {}, write() {} } as never });

  await expect(tools.answer_ask("agent-pm", { askId: "ask-1", answer: "no" })).rejects.toThrow("Only architect agent can answer");
  await tools.answer_ask("agent-architect", { askId: "ask-1", answer: "yes" });
  expect((await store.loadPendingAsk("ask-1"))?.answer).toBe("yes");

  router.close();
  rmSync(root, { recursive: true, force: true });
});

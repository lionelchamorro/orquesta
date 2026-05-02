import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { AskRouter } from "../daemon/ask-router";

test("ask-router routes architect-targeted asks to architect", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-ask-role-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.saveAgent({ id: "agent-pm", role: "pm", cli: "claude", model: "m", status: "live", session_cwd: "." });
  await store.saveAgent({ id: "agent-architect", role: "architect", cli: "claude", model: "m", status: "live", session_cwd: "." });
  const writes: string[] = [];
  const bus = new Bus();

  const askSeen = new Promise<string>((resolve) => {
    const unsubscribe = bus.subscribe("worker-1", (event) => {
      if (event.payload.type === "ask_user") {
        unsubscribe();
        resolve(event.payload.askId);
      }
    });
  });
  const routed = new AskRouter(store, { write(agentId: string) { writes.push(agentId); } } as never, bus);
  const answerPromise = routed.ask("worker-1", "cache this?", undefined, "architect");
  const askId = await askSeen;
  await routed.answer(askId, "yes", "agent-architect");
  const ask = await store.loadPendingAsk(askId);

  expect(writes).toEqual(["agent-architect"]);
  expect(ask?.target_role).toBe("architect");
  expect(await answerPromise).toBe("yes");
  routed.close();
  rmSync(root, { recursive: true, force: true });
});

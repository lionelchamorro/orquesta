import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { AskRouter } from "../daemon/ask-router";

test("ask-router falls back and accepts human answer", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-ask-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  const bus = new Bus();
  const pool = {
    write() {},
  } as never;
  const router = new AskRouter(store, pool, bus);
  const answerPromise = router.ask("agent-a", "merge or rebase?", ["merge", "rebase"]);
  const event = await new Promise<{ askId: string }>((resolve) => {
    const unsubscribe = bus.subscribe("agent-a", (entry) => {
      if (entry.payload.type === "ask_user") {
        unsubscribe();
        resolve({ askId: entry.payload.askId });
      }
    });
  });
  await router.answer(event.askId, "rebase", "human-fallback");
  expect(await answerPromise).toBe("rebase");
  router.close();
  rmSync(root, { recursive: true, force: true });
});

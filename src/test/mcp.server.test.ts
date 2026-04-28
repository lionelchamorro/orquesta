import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import { AskRouter } from "../daemon/ask-router";
import { createMcpHandler } from "../mcp/server";

test("mcp handler rejects requests without the daemon session token", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-mcp-auth-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.saveAgent({
    id: "agent-1",
    role: "planner",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });
  const bus = new Bus();
  const pool = { write() {}, kill() {} } as never;
  const askRouter = new AskRouter(store, pool, bus);
  const handler = createMcpHandler({ store, bus, askRouter, agentPool: pool, sessionToken: "secret-token" });

  const unauthorized = await handler(new Request("http://localhost/mcp/agent-1", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }));
  const authorized = await handler(new Request("http://localhost/mcp/agent-1?token=secret-token", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
  }));

  expect(unauthorized.status).toBe(401);
  expect(authorized.status).toBe(200);
  expect(await authorized.json()).toEqual({ jsonrpc: "2.0", id: 1, result: {} });
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

test("mcp handler accepts initialized notifications without a JSON-RPC response", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-mcp-notify-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  const store = new PlanStore(root);
  await store.saveAgent({
    id: "agent-1",
    role: "planner",
    cli: "claude",
    model: "m",
    status: "live",
    session_cwd: ".",
  });
  const bus = new Bus();
  const pool = { write() {}, kill() {} } as never;
  const askRouter = new AskRouter(store, pool, bus);
  const handler = createMcpHandler({ store, bus, askRouter, agentPool: pool });

  const response = await handler(new Request("http://localhost/mcp/agent-1", {
    method: "POST",
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  }));

  expect(response.status).toBe(202);
  expect(await response.text()).toBe("");
  askRouter.close();
  rmSync(root, { recursive: true, force: true });
});

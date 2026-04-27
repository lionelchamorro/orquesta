import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHttpHandler } from "../api/http";
import { Bus } from "../bus/bus";
import { PlanStore } from "../core/plan-store";
import type { PlannerService } from "../daemon/planner-service";

const makeFakePlannerService = () => {
  const calls: { method: string; prompt?: string }[] = [];
  let currentAgentId: string | null = null;
  const service = {
    getCurrentAgentId: () => currentAgentId,
    async startPlanner(prompt: string) {
      calls.push({ method: "startPlanner", prompt });
      currentAgentId = "agent-planner-1";
      return { agentId: currentAgentId, runId: "run-1" };
    },
    async reset() {
      calls.push({ method: "reset" });
      currentAgentId = null;
    },
  } as unknown as PlannerService;
  return { service, calls, setAgentId: (id: string | null) => { currentAgentId = id; } };
};

const makeHandler = async (plannerService: PlannerService | undefined, planStatus: string) => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-http-planner-"));
  mkdirSync(path.join(root, ".orquesta", "crew"), { recursive: true });
  await Bun.write(path.join(root, ".orquesta", "crew", "plan.json"), JSON.stringify({
    runId: "run-1", prd: "(prompt)", prompt: "", status: planStatus, created_at: "a", updated_at: "a", task_count: 0, completed_count: 0, current_iteration: 1, max_iterations: 1,
  }));
  const store = new PlanStore(root);
  const handler = createHttpHandler({
    root,
    store,
    pool: { write() {}, kill() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
    plannerService,
  });
  return { root, handler };
};

test("protected mutations require the daemon session token when configured", async () => {
  const { service, calls } = makeFakePlannerService();
  const { root, handler } = await makeHandler(service, "done");
  const protectedHandler = createHttpHandler({
    root,
    store: new PlanStore(root),
    pool: { write() {}, kill() {} } as never,
    bus: new Bus(),
    askRouter: { answer: async () => {} } as never,
    mcpHandler: async () => new Response("ok"),
    plannerService: service,
    sessionToken: "secret-token",
  });

  const unauthorized = await protectedHandler(new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "build a hello CLI" }),
  }));
  const authorized = await protectedHandler(new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Orquesta-Token": "secret-token" },
    body: JSON.stringify({ prompt: "build a hello CLI" }),
  }));

  expect(unauthorized.status).toBe(401);
  expect(authorized.status).toBe(200);
  expect(calls).toEqual([{ method: "startPlanner", prompt: "build a hello CLI" }]);
  rmSync(root, { recursive: true, force: true });
});

test("POST /api/plan starts planner and returns agentId", async () => {
  const { service, calls } = makeFakePlannerService();
  const { root, handler } = await makeHandler(service, "done");

  const response = await handler(new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "build a hello CLI" }),
  }));
  const body = await response.json();

  expect(response.status).toBe(200);
  expect(body.agentId).toBe("agent-planner-1");
  expect(body.runId).toBe("run-1");
  expect(calls).toEqual([{ method: "startPlanner", prompt: "build a hello CLI" }]);
  rmSync(root, { recursive: true, force: true });
});

test("POST /api/plan rejects empty prompt", async () => {
  const { service, calls } = makeFakePlannerService();
  const { root, handler } = await makeHandler(service, "done");

  const response = await handler(new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "   " }),
  }));

  expect(response.status).toBe(400);
  expect(calls.length).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("POST /api/plan conflicts when run is already approved", async () => {
  const { service, calls } = makeFakePlannerService();
  const { root, handler } = await makeHandler(service, "approved");

  const response = await handler(new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "anything" }),
  }));

  expect(response.status).toBe(409);
  expect(calls.length).toBe(0);
  rmSync(root, { recursive: true, force: true });
});

test("POST /api/plan/reset invokes reset", async () => {
  const { service, calls } = makeFakePlannerService();
  const { root, handler } = await makeHandler(service, "awaiting_approval");

  const response = await handler(new Request("http://localhost/api/plan/reset", { method: "POST" }));

  expect(response.status).toBe(200);
  expect(calls).toEqual([{ method: "reset" }]);
  rmSync(root, { recursive: true, force: true });
});

test("GET /api/runs/current includes plannerAgentId", async () => {
  const { service, setAgentId } = makeFakePlannerService();
  setAgentId("agent-planner-9");
  const { root, handler } = await makeHandler(service, "drafting");

  const response = await handler(new Request("http://localhost/api/runs/current"));
  const body = await response.json();

  expect(body.plannerAgentId).toBe("agent-planner-9");
  rmSync(root, { recursive: true, force: true });
});

test("POST /api/plan returns 503 when plannerService is absent", async () => {
  const { root, handler } = await makeHandler(undefined, "done");

  const response = await handler(new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "x" }),
  }));

  expect(response.status).toBe(503);
  rmSync(root, { recursive: true, force: true });
});

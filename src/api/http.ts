import path from "node:path";
import type { AgentPool } from "../agents/pool";
import type { Bus } from "../bus/bus";
import { HUMAN_FALLBACK_AGENT_ID, type AskRouter } from "../daemon/ask-router";
import type { PlannerService } from "../daemon/planner-service";
import type { PlanStore } from "../core/plan-store";
import type { Role } from "../core/types";

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });

export const createHttpHandler = (deps: {
  root: string;
  store: PlanStore;
  pool: AgentPool;
  bus: Bus;
  askRouter: AskRouter;
  mcpHandler: (req: Request) => Promise<Response>;
  plannerService?: PlannerService;
  uiBuildDir?: string;
}) => {
  return async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/mcp/")) return deps.mcpHandler(req);
    if (url.pathname === "/") {
      if (deps.uiBuildDir) return new Response(Bun.file(path.join(deps.uiBuildDir, "index.html")));
      return new Response(Bun.file(path.join(deps.root, "src", "ui", "index.html")));
    }
    if (url.pathname === "/theme.css") return new Response(Bun.file(path.join(deps.root, "src", "ui", "theme.css")));
    if (url.pathname.startsWith("/assets/") && deps.uiBuildDir) {
      return new Response(Bun.file(path.join(deps.uiBuildDir, url.pathname.slice(1))));
    }

    if (req.method === "GET" && url.pathname === "/api/runs/current") {
      const plan = await deps.store.loadPlan();
      const tasks = await deps.store.loadTasks();
      const iterations = await deps.store.loadIterations();
      const agents = await deps.store.loadAgents();
      const subtasks = (
        await Promise.all(tasks.map((task) => deps.store.loadSubtasks(task.id)))
      ).flat();
      const plannerAgentId = deps.plannerService?.getCurrentAgentId() ?? null;
      return json({ plan, tasks, iterations, agents, subtasks, plannerAgentId });
    }

    if (req.method === "GET" && url.pathname === "/api/runs") {
      const plan = await deps.store.loadPlan();
      return json([plan]);
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/runs\/[^/]+$/)) {
      const runId = url.pathname.split("/")[3];
      const plan = await deps.store.loadPlan();
      const tasks = await deps.store.loadTasks();
      const iterations = await deps.store.loadIterations();
      if (plan.runId !== runId) return json({ error: "run not found" }, { status: 404 });
      return json({ plan, tasks, iterations });
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/runs\/[^/]+\/iterations\/[^/]+$/)) {
      const [, , , runId, , iterId] = url.pathname.split("/");
      const plan = await deps.store.loadPlan();
      if (plan.runId !== runId) return json({ error: "run not found" }, { status: 404 });
      const iterations = await deps.store.loadIterations();
      const iteration = iterations.find((item) => item.id === iterId || String(item.number) === iterId);
      if (!iteration) return json({ error: "iteration not found" }, { status: 404 });
      const tasks = (await deps.store.loadTasks()).filter((task) => task.iteration === iteration.number);
      return json({ iteration, tasks });
    }

    if (req.method === "GET" && url.pathname === "/api/tasks") {
      return json(await deps.store.loadTasks());
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/tasks\/[^/]+$/)) {
      const taskId = url.pathname.split("/")[3];
      const task = await deps.store.loadTask(taskId);
      const subtasks = await deps.store.loadSubtasks(taskId);
      return json({ task, subtasks });
    }

    if (req.method === "GET" && url.pathname.match(/^\/api\/tasks\/[^/]+\/history$/)) {
      const taskId = url.pathname.split("/")[3];
      const task = await deps.store.loadTask(taskId);
      const summaryPath = deps.store.crewPath("tasks", `${taskId}.md`);
      const diff_stat = await Bun.file(summaryPath).text().catch(() => "");
      return json({
        merge_commit: task.merge_commit,
        branch: task.branch,
        archive_path: task.archive_path,
        closure_reason: task.closure_reason,
        diff_stat,
      });
    }

    if (req.method === "GET" && url.pathname === "/api/archive") {
      const tasks = await deps.store.loadTasks();
      return json(tasks.filter((task) => task.archive_path).map((task) => ({
        taskId: task.id,
        title: task.title,
        archive_path: task.archive_path,
        merge_commit: task.merge_commit,
        closure_reason: task.closure_reason,
      })));
    }

    if (req.method === "GET" && url.pathname === "/api/agents") {
      return json(await deps.store.loadAgents());
    }

    if (req.method === "POST" && url.pathname === "/api/plan") {
      if (!deps.plannerService) return json({ error: "planner service unavailable" }, { status: 503 });
      const body = (await req.json().catch(() => ({}))) as { prompt?: unknown };
      const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
      if (!prompt) return json({ error: "prompt required" }, { status: 400 });
      const existingPlan = await deps.store.loadPlan();
      if (existingPlan.status === "approved" || existingPlan.status === "running") {
        return json({ error: "run in progress; call /api/plan/reset first" }, { status: 409 });
      }
      const result = await deps.plannerService.startPlanner(prompt);
      return json({ ok: true, ...result });
    }

    if (req.method === "POST" && url.pathname === "/api/plan/reset") {
      if (!deps.plannerService) return json({ error: "planner service unavailable" }, { status: 503 });
      await deps.plannerService.reset();
      return json({ ok: true });
    }

    if (req.method === "POST" && url.pathname === "/api/approve") {
      const plan = await deps.store.loadPlan();
      deps.plannerService?.killCurrent();
      const next = { ...plan, status: "approved" as const, updated_at: new Date().toISOString() };
      await deps.store.savePlan(next);
      deps.bus.publish({ tags: [plan.runId], payload: { type: "plan_approved", runId: plan.runId, at: next.updated_at } });
      return json({ ok: true, plan: next });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/agents\/[^/]+\/input$/)) {
      const agentId = url.pathname.split("/")[3];
      const body = (await req.json()) as { text: string; role?: Role };
      deps.pool.write(agentId, `${body.text}\n`);
      deps.bus.publish({
        tags: [agentId],
        payload: { type: "broadcast", fromRole: body.role ?? "pm", toAgent: agentId, message: body.text },
      });
      return json({ ok: true });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/tasks\/[^/]+\/cancel$/)) {
      const taskId = url.pathname.split("/")[3];
      const task = await deps.store.loadTask(taskId);
      if (task.status === "done") {
        return json({ ok: false, error: "Cannot cancel a completed task" }, { status: 400 });
      }
      const agents = await deps.store.loadAgents();
      for (const agent of agents) {
        if (agent.bound_subtask && task.subtasks.includes(agent.bound_subtask) && agent.status !== "dead") {
          deps.pool.kill(agent.id);
        }
      }
      await deps.store.saveTask({ ...task, status: "cancelled", updated_at: new Date().toISOString() });
      deps.bus.publish({ tags: [taskId, `iter-${task.iteration}`], payload: { type: "task_cancelled", taskId } });
      return json({ ok: true });
    }

    if (req.method === "POST" && url.pathname.match(/^\/api\/ask\/[^/]+\/answer$/)) {
      const askId = url.pathname.split("/")[3];
      const body = (await req.json()) as { answer: string; fromAgent?: string };
      try {
        await deps.askRouter.answer(askId, body.answer, body.fromAgent ?? HUMAN_FALLBACK_AGENT_ID);
        return json({ ok: true });
      } catch (error) {
        return json({ ok: false, error: error instanceof Error ? error.message : "Unknown ask error" }, { status: 400 });
      }
    }

    return new Response("not found", { status: 404 });
  };
};

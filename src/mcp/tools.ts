import { rmSync } from "node:fs";
import { nextSubtaskId, nextTaskId } from "../core/ids";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";
import type { AskRouter } from "../daemon/ask-router";
import type { AgentPool } from "../agents/pool";
import type { CriticFinding, Role, Subtask, Task, TaskEvidence } from "../core/types";

const parseRecord = (value: unknown, name: string) => {
  if (!value || typeof value !== "object") throw new Error(`Invalid ${name}`);
  return value as Record<string, unknown>;
};

const stringList = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;

const parseReportProgress = (value: unknown) => {
  const record = parseRecord(value, "report_progress");
  if (typeof record.status !== "string" || typeof record.note !== "string") throw new Error("Invalid report_progress arguments");
  return { status: record.status, note: record.note };
};

const parseReportComplete = (value: unknown) => {
  const record = parseRecord(value, "report_complete");
  if (typeof record.summary !== "string") throw new Error("Invalid report_complete arguments");
  const evidenceRecord = record.evidence && typeof record.evidence === "object" ? (record.evidence as Record<string, unknown>) : undefined;
  return {
    summary: record.summary,
    evidence: evidenceRecord
      ? {
          commits: stringList(evidenceRecord.commits),
          tests: stringList(evidenceRecord.tests),
          artifacts: stringList(evidenceRecord.artifacts),
        }
      : undefined,
  };
};

const parseAskUser = (value: unknown) => {
  const record = parseRecord(value, "ask_user");
  if (typeof record.question !== "string") throw new Error("Invalid ask_user arguments");
  return { question: record.question, options: stringList(record.options) };
};

const parseAnswerPeer = (value: unknown) => {
  const record = parseRecord(value, "answer_peer");
  if (typeof record.askId !== "string" || typeof record.answer !== "string") throw new Error("Invalid answer_peer arguments");
  return { askId: record.askId, answer: record.answer };
};

const parseEmitTasks = (value: unknown) => {
  const record = parseRecord(value, "emit_tasks");
  if (!Array.isArray(record.tasks)) throw new Error("Invalid emit_tasks arguments");
  return {
    replace: record.replace === false ? false : true,
    tasks: record.tasks.map((task) => {
      const item = parseRecord(task, "emit_tasks.task");
      if (typeof item.title !== "string") throw new Error("Invalid emit_tasks task title");
      return {
        localId: typeof item.id === "string" ? item.id : undefined,
        title: item.title,
        description: typeof item.description === "string" ? item.description : undefined,
        depends_on: stringList(item.depends_on) ?? [],
      };
    }),
  };
};

const resolveDependencies = (
  rawDeps: string[],
  localIdMap: Map<string, string>,
  existingIds: Set<string>,
): string[] => {
  const resolved: string[] = [];
  for (const dep of rawDeps) {
    const canonical = localIdMap.get(dep) ?? (existingIds.has(dep) ? dep : undefined);
    if (!canonical) {
      throw new Error(`emit_tasks: dependency "${dep}" does not match any task in this batch or existing task`);
    }
    resolved.push(canonical);
  }
  return resolved;
};

const parseReviewSubtask = (value: unknown) => {
  const record = parseRecord(value, "request_review_subtask");
  if (!Array.isArray(record.findings)) throw new Error("Invalid request_review_subtask arguments");
  return {
    findings: record.findings.map((finding) => {
      const item = parseRecord(finding, "finding");
      if (
        !["low", "medium", "high"].includes(String(item.severity)) ||
        typeof item.description !== "string"
      ) {
        throw new Error("Invalid critic finding");
      }
      return {
        severity: item.severity as CriticFinding["severity"],
        description: item.description,
        file: typeof item.file === "string" ? item.file : undefined,
        suggestion: typeof item.suggestion === "string" ? item.suggestion : undefined,
      };
    }),
  };
};

const parseBroadcast = (value: unknown) => {
  const record = parseRecord(value, "broadcast");
  if (typeof record.toAgent !== "string" || typeof record.message !== "string") throw new Error("Invalid broadcast arguments");
  return { toAgent: record.toAgent, message: record.message };
};

const toolResult = (value: unknown) => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
});

type ToolDeps = {
  store: PlanStore;
  bus: Bus;
  askRouter: AskRouter;
  agentPool: AgentPool;
};

const updateTaskSummary = async (store: PlanStore, taskId: string, summary: string, evidence?: TaskEvidence) => {
  const task = await store.loadTask(taskId);
  const next: Task = {
    ...task,
    updated_at: new Date().toISOString(),
    summary,
    evidence: evidence ?? task.evidence,
  };
  if (task.status !== "done") next.status = "running";
  await store.saveTask(next);
};

export const toolDefinitions = [
  { name: "ask_user", description: "Ask the PM agent a question.", inputSchema: { type: "object" } },
  { name: "answer_peer", description: "Answer a routed PM question.", inputSchema: { type: "object" } },
  { name: "report_progress", description: "Emit activity from the current agent.", inputSchema: { type: "object" } },
  { name: "report_complete", description: "Mark the bound subtask completed.", inputSchema: { type: "object" } },
  { name: "request_review_subtask", description: "Create fix subtasks from critic findings.", inputSchema: { type: "object" } },
  { name: "emit_tasks", description: "Emit tasks into the current iteration.", inputSchema: { type: "object" } },
  { name: "broadcast", description: "Send a message to another live agent terminal.", inputSchema: { type: "object" } },
] as const;

export const createToolHandlers = ({ store, bus, askRouter, agentPool }: ToolDeps) => ({
  async ask_user(agentId: string, arguments_: unknown) {
    const args = parseAskUser(arguments_);
    const answer = await askRouter.ask(agentId, args.question, args.options);
    return toolResult({ answer });
  },

  async answer_peer(agentId: string, arguments_: unknown) {
    const args = parseAnswerPeer(arguments_);
    await askRouter.answer(args.askId, args.answer, agentId);
    return toolResult({ ok: true });
  },

  async report_progress(agentId: string, arguments_: unknown) {
    const args = parseReportProgress(arguments_);
    const agent = await store.loadAgent(agentId);
    if (agent) {
      await store.saveAgent({ ...agent, last_activity_at: new Date().toISOString() });
    }
    if (args.status.toLowerCase() === "failed") {
      if (agent?.bound_subtask && agent.bound_task) {
        const subtask = await store.loadSubtask(agent.bound_task, agent.bound_subtask).catch(() => null);
        if (subtask) {
          await store.saveSubtask({
            ...subtask,
            status: "failed",
            completed_at: new Date().toISOString(),
            summary: args.note,
          });
          bus.publish({
            tags: [agentId, agent.bound_task, subtask.id, agent.role],
            payload: { type: "subtask_failed", subtaskId: subtask.id, reason: args.note },
          });
        }
      } else {
        bus.publish({
          tags: [agentId, agent?.role ?? ""].filter(Boolean),
          payload: { type: "agent_failed", agentId, reason: args.note },
        });
      }
      agentPool.kill(agentId);
    }
    bus.publish({
      tags: [agentId, agent?.role ?? ""].filter(Boolean),
      payload: { type: "activity", fromAgent: agentId, message: `${args.status}: ${args.note}` },
    });
    return toolResult({ ok: true });
  },

  async report_complete(agentId: string, arguments_: unknown) {
    const args = parseReportComplete(arguments_);
    const agent = await store.loadAgent(agentId);
    if (!agent) return toolResult({ ok: false, error: "Unknown agent" });
    if (!agent.bound_subtask) {
      bus.publish({
        tags: [agentId, agent.role],
        payload: { type: "agent_completed", agentId, summary: args.summary },
      });
      agentPool.kill(agentId);
      return toolResult({ ok: true });
    }
    const taskId = agent.bound_task ?? (await store.loadTasks()).find((item) => item.subtasks.includes(agent.bound_subtask!))?.id;
    if (!taskId) return toolResult({ ok: false, error: "No task for subtask" });
    const task = await store.loadTask(taskId);
    const subtask = await store.loadSubtask(task.id, agent.bound_subtask);
    // Publish completion before terminating the PTY so MCP callers receive a clean response.
    const nextSubtask: Subtask = {
      ...subtask,
      status: "done",
      completed_at: new Date().toISOString(),
      summary: args.summary,
      artifacts: args.evidence?.artifacts,
    };
    await store.saveSubtask(nextSubtask);
    await updateTaskSummary(store, task.id, args.summary, args.evidence);
    bus.publish({
      tags: [agentId, task.id, subtask.id, agent.role],
      payload: { type: "subtask_completed", subtaskId: subtask.id, summary: args.summary },
    });
    agentPool.kill(agentId);
    return toolResult({ ok: true });
  },

  async request_review_subtask(agentId: string, arguments_: unknown) {
    const args = parseReviewSubtask(arguments_);
    const agent = await store.loadAgent(agentId);
    if (!agent?.bound_subtask) return toolResult({ ok: false, error: "No bound subtask" });
    const taskId = agent.bound_task ?? (await store.loadTasks()).find((item) => item.subtasks.includes(agent.bound_subtask!))?.id;
    if (!taskId) return toolResult({ ok: false, error: "No task for subtask" });
    const task = await store.loadTask(taskId);
    const existing = await store.loadSubtasks(task.id);
    const subtaskId = nextSubtaskId(existing.map((item) => item.id));
    const subtask: Subtask = {
      id: subtaskId,
      taskId: task.id,
      type: "fix",
      role: "coder",
      status: "pending",
      prompt: args.findings.map((finding) => finding.description).join("\n"),
      depends_on: [agent.bound_subtask],
      created_at: new Date().toISOString(),
      findings: args.findings as CriticFinding[],
    };
    task.subtasks.push(subtaskId);
    task.updated_at = new Date().toISOString();
    await store.saveSubtask(subtask);
    await store.saveTask(task);
    bus.publish({
      tags: [task.id, subtask.id, agentId, agent.role],
      payload: { type: "critic_findings", subtaskId, findings: args.findings as CriticFinding[] },
    });
    return toolResult({ ok: true, subtaskId });
  },

  async emit_tasks(agentId: string, arguments_: unknown) {
    const args = parseEmitTasks(arguments_);
    const plan = await store.loadPlan();
    let existing = await store.loadTasks();
    const created: string[] = [];
    const iterations = await store.loadIterations();
    const existingIteration = iterations.find((iteration) => iteration.number === plan.current_iteration) ?? null;
    let currentIteration = existingIteration
      ? { ...existingIteration, task_ids: [...existingIteration.task_ids] }
      : null;
    if (args.replace) {
      const toRemove = existing.filter((task) => task.iteration === plan.current_iteration);
      for (const task of toRemove) {
        rmSync(store.crewPath("tasks", `${task.id}.json`), { force: true });
        rmSync(store.crewPath("subtasks", task.id), { recursive: true, force: true });
      }
      existing = existing.filter((task) => task.iteration !== plan.current_iteration);
      if (currentIteration) currentIteration = { ...currentIteration, task_ids: [] };
    }

    // First pass: assign canonical IDs and build the localId → canonicalId map.
    // Supports planner referring to tasks via:
    //   - an explicit `id` field (e.g. "t2")
    //   - the positional label "t{n}" where n is the 1-based index in the batch
    //   - the canonical "task-{n}" itself
    const localIdMap = new Map<string, string>();
    const pendingCanonicalIds: string[] = [];
    for (const [index, taskInput] of args.tasks.entries()) {
      const taskId = nextTaskId([...existing.map((item) => item.id), ...pendingCanonicalIds]);
      pendingCanonicalIds.push(taskId);
      localIdMap.set(taskId, taskId);
      localIdMap.set(`t${index + 1}`, taskId);
      if (taskInput.localId) localIdMap.set(taskInput.localId, taskId);
    }
    const existingIds = new Set(existing.map((task) => task.id));

    // Second pass: persist tasks with resolved dependencies.
    for (const [index, taskInput] of args.tasks.entries()) {
      const taskId = pendingCanonicalIds[index];
      const resolvedDeps = resolveDependencies(taskInput.depends_on, localIdMap, existingIds);
      const task: Task = {
        id: taskId,
        title: taskInput.title,
        description: taskInput.description,
        status: "pending",
        depends_on: resolvedDeps,
        iteration: plan.current_iteration,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        attempt_count: 0,
        subtasks: [],
      };
      await store.saveTask(task);
      if (currentIteration) {
        currentIteration.task_ids.push(taskId);
      }
      created.push(taskId);
      if (task.depends_on.length === 0) {
        bus.publish({ tags: [task.id, `iter-${task.iteration}`, agentId], payload: { type: "task_ready", taskId } });
      }
    }
    if (currentIteration) {
      await store.saveIteration({ ...currentIteration });
    }
    bus.publish({
      tags: [plan.runId, `iter-${plan.current_iteration}`, agentId],
      payload: { type: "tasks_emitted", runId: plan.runId, iteration: plan.current_iteration, taskIds: created },
    });
    return toolResult({ created });
  },

  async broadcast(agentId: string, arguments_: unknown) {
    const args = parseBroadcast(arguments_);
    const from = await store.loadAgent(agentId);
    agentPool.write(args.toAgent, `${args.message}\n`);
    bus.publish({
      tags: [agentId, args.toAgent],
      payload: { type: "broadcast", fromRole: from?.role ?? "pm", toAgent: args.toAgent, message: args.message },
    });
    return toolResult({ ok: true });
  },
});

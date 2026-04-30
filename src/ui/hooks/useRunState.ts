import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, Iteration, Plan, Subtask, Task } from "../../core/types";
import { DAEMON_HTTP } from "../config";
import { useBus } from "./useBus";

export type Mode = "empty" | "run";

const resolveMode = (plan: Plan | null, tasks: Task[]): Mode => {
  if (!plan) return "empty";
  if (tasks.length === 0) return "empty";
  return "run";
};

const selectedRunAgent = (agents: Agent[], selectedAgentId?: string): Agent | undefined => {
  const selected = selectedAgentId ? agents.find((agent) => agent.id === selectedAgentId) : undefined;
  if (selected && selected.role !== "planner") return selected;
  return agents.find((agent) => agent.role !== "planner" && agent.status !== "dead");
};

export const useRunState = () => {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string>();
  const [selectedAgentId, setSelectedAgentId] = useState<string>();
  const [drawerAgentId, setDrawerAgentId] = useState<string>();
  const [selectedIterationNumber, setSelectedIterationNumber] = useState<number>(1);
  const [pinnedAgentIds, setPinnedAgentIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem("orq.pinnedAgents");
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch {
      return new Set();
    }
  });

  const events = useBus();

  const refresh = useCallback(async () => {
    const response = await fetch(`${DAEMON_HTTP}/api/runs/current`, { credentials: "include" });
    const data = await response.json();
    setPlan(data.plan);
    setTasks(data.tasks);
    setIterations(data.iterations);
    setAgents(data.agents);
    setSubtasks(data.subtasks ?? []);
    if (typeof data.plan?.current_iteration === "number") {
      setSelectedIterationNumber(data.plan.current_iteration);
    }
    if (!selectedTaskId && data.tasks[0]) setSelectedTaskId(data.tasks[0].id);
    const mode = resolveMode(data.plan, data.tasks);
    const nextAgent = mode === "run"
      ? selectedRunAgent(data.agents, selectedAgentId)
      : (!selectedAgentId ? data.agents[0] : undefined);
    if (nextAgent) setSelectedAgentId(nextAgent.id);
  }, [selectedTaskId, selectedAgentId]);

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const last = events[events.length - 1];
    if (!last) return;
    const payload = last.payload;
    if (payload.type === "plan_approved") {
      setPlan((current) => current ? { ...current, status: "approved", updated_at: payload.at } : current);
      void refresh();
      return;
    }
    if (payload.type === "tasks_emitted") {
      void refresh();
      return;
    }
    if (payload.type === "iteration_started") {
      setIterations((current) => {
        const next: Iteration = {
          id: payload.iterationId,
          number: payload.number,
          runId: plan?.runId ?? "run-1",
          trigger: payload.trigger,
          started_at: new Date().toISOString(),
          task_ids: [],
        };
        return [...current.filter((item) => item.id !== payload.iterationId), next];
      });
      setPlan((current) => current ? { ...current, current_iteration: payload.number } : current);
      return;
    }
    if (
      payload.type === "task_ready" ||
      payload.type === "task_started" ||
      payload.type === "task_completed" ||
      payload.type === "task_cancelled" ||
      payload.type === "subtask_started" ||
      payload.type === "subtask_completed" ||
      payload.type === "subtask_failed" ||
      payload.type === "critic_findings" ||
      payload.type === "task_merged" ||
      payload.type === "task_archived" ||
      payload.type === "ask_user_answered"
    ) {
      void refresh();
      return;
    }
    if (payload.type === "agent_completed" || payload.type === "agent_failed") {
      setAgents((current) => current.map((agent) => agent.id === payload.agentId ? { ...agent, status: "dead" } : agent));
      setPinnedAgentIds((current) => {
        if (current.has(payload.agentId)) return current;
        const next = new Set(current);
        next.add(payload.agentId);
        try { localStorage.setItem("orq.pinnedAgents", JSON.stringify([...next])); } catch {}
        return next;
      });
      return;
    }
    if (payload.type === "run_completed") {
      setPlan((current) => current ? { ...current, status: "done" } : current);
    }
  }, [events, refresh, plan?.runId]);

  const togglePin = useCallback((agentId: string) => {
    setPinnedAgentIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      try { localStorage.setItem("orq.pinnedAgents", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const selectedIteration = useMemo(
    () => iterations.find((iteration) => iteration.number === selectedIterationNumber) ?? null,
    [iterations, selectedIterationNumber],
  );
  const iterationTasks = useMemo(
    () => tasks.filter((task) => task.iteration === selectedIterationNumber),
    [tasks, selectedIterationNumber],
  );
  const taskIdBySubtaskId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const subtask of subtasks) map[subtask.id] = subtask.taskId;
    return map;
  }, [subtasks]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );
  const agentTaskId = useCallback((agent: Agent): string | null =>
    agent.bound_task ?? (agent.bound_subtask ? taskIdBySubtaskId[agent.bound_subtask] ?? null : null),
  [taskIdBySubtaskId]);
  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    const belongs = (agent: Agent) => agentTaskId(agent) === taskId;
    const live = agents.find((agent) => belongs(agent) && agent.status !== "dead");
    const fallback = agents.find(belongs);
    const next = live ?? fallback;
    if (next) setSelectedAgentId(next.id);
  }, [agents, agentTaskId]);

  const mode = resolveMode(plan, tasks);
  const selectedTerminalAgent = mode === "run" ? selectedRunAgent(agents, selectedAgentId) : undefined;
  const effectiveSelectedAgentId = mode === "run" ? selectedTerminalAgent?.id : selectedAgentId;
  const chatTargetAgentId = selectedTerminalAgent?.status === "dead" ? undefined : effectiveSelectedAgentId;

  return {
    plan,
    tasks,
    agents,
    events,
    subtasks,
    selectedTaskId,
    selectedAgentId,
    setSelectedAgentId,
    drawerAgentId,
    setDrawerAgentId,
    selectedIterationNumber,
    setSelectedIterationNumber,
    pinnedAgentIds,
    togglePin,
    refresh,
    selectedIteration,
    iterationTasks,
    selectedTask,
    agentTaskId,
    selectTask,
    mode,
    selectedTerminalAgent,
    effectiveSelectedAgentId,
    chatTargetAgentId,
  };
};

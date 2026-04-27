import { createRoot } from "react-dom/client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Agent, Iteration, Plan, Subtask, Task } from "../core/types";
import { useBus } from "./hooks/useBus";
import { Shell } from "./components/Shell";
import { IterationNav } from "./components/IterationNav";
import { TasksPanel } from "./components/TasksPanel";
import { ActivityFeed } from "./components/ActivityFeed";
import { AgentsPanel } from "./components/AgentsPanel";
import { LiveStream } from "./components/LiveStream";
import { ChatComposer } from "./components/ChatComposer";
import { PlanPrompt } from "./components/PlanPrompt";
import { TerminalDrawer } from "./components/TerminalDrawer";
import { Toast } from "./components/Toast";

type Mode = "empty" | "planner" | "run";

export const taskDisplayId = (taskId: string): string =>
  taskId.replace(/^task-/i, "T").toUpperCase();

const resolveMode = (plan: Plan | null, plannerAgentId: string | null, tasks: Task[]): Mode => {
  if (!plan) return "empty";
  if (plannerAgentId) return "planner";
  if (plan.status === "drafting" || plan.status === "awaiting_approval") return "planner";
  if (tasks.length === 0) return "empty";
  return "run";
};

function App() {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [iterations, setIterations] = useState<Iteration[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [plannerAgentId, setPlannerAgentId] = useState<string | null>(null);
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
  const togglePin = useCallback((agentId: string) => {
    setPinnedAgentIds((current) => {
      const next = new Set(current);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      try { localStorage.setItem("orq.pinnedAgents", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);
  const events = useBus();

  const refresh = useCallback(async () => {
    const response = await fetch("/api/runs/current");
    const data = await response.json();
    setPlan(data.plan);
    setTasks(data.tasks);
    setIterations(data.iterations);
    setAgents(data.agents);
    setSubtasks(data.subtasks ?? []);
    setPlannerAgentId(data.plannerAgentId ?? null);
    if (typeof data.plan?.current_iteration === "number") {
      setSelectedIterationNumber(data.plan.current_iteration);
    }
    if (!selectedTaskId && data.tasks[0]) setSelectedTaskId(data.tasks[0].id);
    if (!selectedAgentId && data.agents[0]) setSelectedAgentId(data.agents[0].id);
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
      setPlannerAgentId(null);
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
      if (payload.agentId === plannerAgentId) {
        setPlannerAgentId(null);
        void refresh();
      }
      return;
    }
    if (payload.type === "run_completed") {
      setPlan((current) => current ? { ...current, status: "done" } : current);
    }
  }, [events]);

  const selectedIteration = useMemo(
    () => iterations.find((iteration) => iteration.number === selectedIterationNumber) ?? null,
    [iterations, selectedIterationNumber],
  );

  const iterationTasks = tasks.filter((task) => task.iteration === selectedIterationNumber);
  const taskIdBySubtaskId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const subtask of subtasks) map[subtask.id] = subtask.taskId;
    return map;
  }, [subtasks]);
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId],
  );
  const agentTaskId = (agent: Agent): string | null =>
    agent.bound_task ?? (agent.bound_subtask ? taskIdBySubtaskId[agent.bound_subtask] ?? null : null);
  const selectTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    const belongs = (agent: Agent) => agentTaskId(agent) === taskId;
    const live = agents.find((agent) => belongs(agent) && agent.status !== "dead");
    const fallback = agents.find(belongs);
    const next = live ?? fallback;
    if (next) setSelectedAgentId(next.id);
  }, [agents, taskIdBySubtaskId]);
  const plannerAgent = useMemo(
    () => agents.find((agent) => agent.id === plannerAgentId) ?? (plannerAgentId ? {
      id: plannerAgentId,
      role: "planner" as const,
      cli: "claude" as const,
      model: "unknown",
      status: "live" as const,
      session_cwd: "",
    } : undefined),
    [agents, plannerAgentId],
  );

  const approve = useCallback(async () => {
    await fetch("/api/approve", { method: "POST" });
    await refresh();
  }, [refresh]);

  const resetPlan = useCallback(async () => {
    await fetch("/api/plan/reset", { method: "POST" });
    await refresh();
  }, [refresh]);

  const mode = resolveMode(plan, plannerAgentId, tasks);

  return (
    <div className="app-shell">
      <Shell plan={plan} />
      {mode === "empty" && (
        <PlanPrompt onStarted={(agentId) => { setPlannerAgentId(agentId); void refresh(); }} />
      )}
      {mode === "planner" && (
        <>
          {(plan?.status === "awaiting_approval" || iterationTasks.length > 0) && plan?.status !== "approved" && plan?.status !== "running" && (
            <div className="planner-approve">
              <div>
                <strong>
                  {plan?.status === "awaiting_approval" ? "Planner ready." : "Tasks drafted."}
                </strong>{" "}
                <span className="muted">
                  {plan?.status === "awaiting_approval"
                    ? "Review tasks below and approve to start the run."
                    : "You can run them now or keep iterating with the planner."}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="secondary" onClick={() => void resetPlan()}>Reset</button>
                <button onClick={() => void approve()}>
                  {plan?.status === "awaiting_approval" ? "Approve & Start" : "Run"}
                </button>
              </div>
            </div>
          )}
          <div className="planner-layout">
            <div className="column tasks">
              <TasksPanel
                tasks={iterationTasks}
                subtasks={subtasks}
                agents={agents}
                iterationNumber={selectedIterationNumber}
                selectedTaskId={selectedTaskId}
                onSelect={selectTask}
              />
            </div>
            <div className="column">
              <LiveStream agent={plannerAgent} />
            </div>
            <div className="column right">
              <ChatComposer
                targetAgentId={plannerAgentId ?? undefined}
                label="to planner"
                placeholder="Ask the planner to adjust, add, or remove tasks…"
              />
              <ActivityFeed
                events={events}
                iterationNumber={selectedIterationNumber}
                selectedTaskId={selectedTaskId}
              />
            </div>
          </div>
        </>
      )}
      {mode === "run" && (
        <>
          <IterationNav
            plan={plan ? { ...plan, current_iteration: selectedIterationNumber } : null}
            iteration={selectedIteration}
            onPrev={() => setSelectedIterationNumber((current) => Math.max(1, current - 1))}
            onNext={() => setSelectedIterationNumber((current) => Math.min(plan?.max_iterations ?? current, current + 1))}
          />
          <div className="run-body">
            <div className="layout">
              <div className="column tasks">
                <TasksPanel
                  tasks={iterationTasks}
                  subtasks={subtasks}
                  agents={agents}
                  iterationNumber={selectedIterationNumber}
                  selectedTaskId={selectedTaskId}
                  onSelect={selectTask}
                />
              </div>
              <div className="column activity">
                <ActivityFeed
                  events={events}
                  iterationNumber={selectedIterationNumber}
                  selectedTaskId={selectedTaskId}
                />
              </div>
              <div className="column right">
                <AgentsPanel
                  agents={agents}
                  agentTaskId={agentTaskId}
                  selectedAgentId={selectedAgentId}
                  selectedTaskId={selectedTaskId}
                  selectedTaskLabel={selectedTask ? taskDisplayId(selectedTask.id) : undefined}
                  pinnedAgentIds={pinnedAgentIds}
                  onTogglePin={togglePin}
                  onSelect={setSelectedAgentId}
                  onOpenTerminal={setDrawerAgentId}
                />
                <ChatComposer targetAgentId={selectedAgentId} label="as PM" />
              </div>
            </div>
            <div className="live-row">
              <LiveStream agent={agents.find((agent) => agent.id === selectedAgentId)} />
            </div>
          </div>
        </>
      )}
      <Toast events={events} />
      <TerminalDrawer
        agentId={drawerAgentId}
        agent={agents.find((agent) => agent.id === drawerAgentId)}
        onClose={() => setDrawerAgentId(undefined)}
      />
    </div>
  );
}

const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);

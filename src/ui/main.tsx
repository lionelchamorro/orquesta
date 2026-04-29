import { createRoot } from "react-dom/client";
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
import { useRunState } from "./hooks/useRunState";
import { taskDisplayId } from "./utils/format";

function App() {
  const {
    plan,
    agents,
    events,
    subtasks,
    plannerAgentId,
    setPlannerAgentId,
    selectedTaskId,
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
    plannerAgent,
    approve,
    resetPlan,
    mode,
    selectedTerminalAgent,
    effectiveSelectedAgentId,
    chatTargetAgentId,
  } = useRunState();

  return (
    <div className="app-shell">
      <Shell plan={plan} />
      {mode === "empty" && (
        <PlanPrompt onStarted={(agentId) => { setPlannerAgentId(agentId); void refresh(); }} />
      )}
      {mode === "planner" && (
        <div className="planner-mode">
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
            <div className="column live">
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
        </div>
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
                  selectedAgentId={effectiveSelectedAgentId}
                  selectedTaskId={selectedTaskId}
                  selectedTaskLabel={selectedTask ? taskDisplayId(selectedTask.id) : undefined}
                  pinnedAgentIds={pinnedAgentIds}
                  onTogglePin={togglePin}
                  onSelect={setSelectedAgentId}
                  onOpenTerminal={setDrawerAgentId}
                />
                <ChatComposer targetAgentId={chatTargetAgentId} label="as PM" />
              </div>
            </div>
            {selectedTerminalAgent && (
              <div className="live-row">
                <LiveStream agent={selectedTerminalAgent} />
              </div>
            )}
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

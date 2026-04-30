import { createRoot } from "react-dom/client";
import { Shell } from "./components/Shell";
import { IterationNav } from "./components/IterationNav";
import { TasksPanel } from "./components/TasksPanel";
import { ActivityFeed } from "./components/ActivityFeed";
import { AgentsPanel } from "./components/AgentsPanel";
import { LiveStream } from "./components/LiveStream";
import { ChatComposer } from "./components/ChatComposer";
import { EmptyState } from "./components/EmptyState";
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
    selectedTaskId,
    setSelectedAgentId,
    drawerAgentId,
    setDrawerAgentId,
    selectedIterationNumber,
    setSelectedIterationNumber,
    pinnedAgentIds,
    togglePin,
    selectedIteration,
    iterationTasks,
    selectedTask,
    agentTaskId,
    selectTask,
    mode,
    selectedTerminalAgent,
    effectiveSelectedAgentId,
    chatTargetAgentId,
  } = useRunState();

  return (
    <div className="app-shell">
      <Shell plan={plan} />
      {mode === "empty" && <EmptyState />}
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

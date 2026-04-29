import type { Agent, Role, Subtask, Task } from "../../core/types";

export const buildRoleByTaskId = (tasks: Task[], subtasks: Subtask[], agents: Agent[]) => {
  const agentByKey = new Map<string, Agent>();
  for (const agent of agents) {
    if (!agent.bound_subtask) continue;
    const taskId = agent.bound_task;
    if (!taskId) continue;
    agentByKey.set(`${taskId}:${agent.bound_subtask}`, agent);
  }
  const byTask = new Map<string, Role>();
  for (const task of tasks) {
    const live = task.subtasks
      .map((id) => subtasks.find((sub) => sub.id === id && sub.taskId === task.id))
      .filter((sub): sub is Subtask => Boolean(sub));
    const running = live.find((sub) => {
      const agent = agentByKey.get(`${task.id}:${sub.id}`);
      return agent && agent.status !== "dead";
    });
    const latest = running ?? live[live.length - 1];
    if (latest) byTask.set(task.id, latest.role);
  }
  return byTask;
};

import { existsSync } from "node:fs";
import path from "node:path";
import type { AgentPool } from "../agents/pool";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";
import {
  archivePathForTask,
  archiveSessionDir,
  autoCommitAll,
  diffStat,
  ensureRepoReady,
  mergeBranch,
  removeWorktree,
  isGitRepo,
  safeGitOutput,
} from "../core/git";
import type { Config, Task } from "../core/types";

const waitForExitWithTimeout = async (pool: AgentPool, agentId: string, timeoutMs = 5_000) => {
  await Promise.race([
    pool.waitForExit(agentId),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out waiting for ${agentId}`)), timeoutMs)),
  ]).catch(() => undefined);
};

const summaryMarkdown = (task: Task, subtasks: Awaited<ReturnType<PlanStore["loadSubtasks"]>>, diff: string, findings: string[]) => `# ${task.id} — ${task.title}

Closure reason: ${task.closure_reason ?? "unknown"}
Branch: ${task.branch ?? "-"}
Worktree: ${task.worktree_path ?? "-"}
Merge commit: ${task.merge_commit ?? "-"}
Merge error: ${task.merge_error ?? "-"}

## Subtasks

${subtasks
  .map(
    (subtask) =>
      `- ${subtask.id} [${subtask.type}/${subtask.role}] ${subtask.status}${subtask.summary ? ` — ${subtask.summary}` : ""}`,
  )
  .join("\n")}

## Diff Stat

\`\`\`
${diff || "(none)"}
\`\`\`

## Findings

${findings.length > 0 ? findings.map((item) => `- ${item}`).join("\n") : "- none"}
`;

export const closeTask = async (deps: {
  root: string;
  store: PlanStore;
  pool: AgentPool;
  bus: Bus;
  config: Config;
  taskId: string;
  closureReason: NonNullable<Task["closure_reason"]>;
}) => {
  const { root, store, pool, bus, config, taskId, closureReason } = deps;
  let task = await store.loadTask(taskId);
  const subtasks = await store.loadSubtasks(taskId);
  const agents = (await store.loadAgents()).filter((agent) =>
    agent.bound_task === taskId
    || (!agent.bound_task && agent.bound_subtask && task.subtasks.includes(agent.bound_subtask)),
  );
  const plan = await store.loadPlan();
  const archiveRoot = archivePathForTask(root, taskId, plan.runId);

  for (const agent of agents) {
    if (agent.status !== "dead") {
      pool.kill(agent.id);
      await waitForExitWithTimeout(pool, agent.id);
    }
  }

  let mergeCommit = task.merge_commit;
  let diff = "";
  let archivePath: string | undefined;
  let effectiveClosure = closureReason;

  let gitEnabled = false;
  try {
    gitEnabled = Boolean(config.git?.enabled) && ensureRepoReady(root, config.git?.baseBranch ?? "main") && isGitRepo(root);
  } catch {
    gitEnabled = false;
  }
  const shouldMerge = gitEnabled && task.worktree_path && task.branch && task.base_branch && ["critic_ok", "max_attempts"].includes(closureReason);

  if (shouldMerge) {
    try {
      const pendingDiff = task.worktree_path && task.base_branch
        ? safeGitOutput(task.worktree_path, ["diff", "--stat", `${task.base_branch}..HEAD`]).trim()
        : "";
      if (config.git?.autoCommit !== false && task.worktree_path) {
        autoCommitAll(task.worktree_path, `${task.id}: ${task.title} (auto)`);
      }
      const postCommitDiff = task.worktree_path && task.base_branch
        ? safeGitOutput(task.worktree_path, ["diff", "--stat", `${task.base_branch}..HEAD`]).trim()
        : "";
      if (!pendingDiff && !postCommitDiff) {
        effectiveClosure = "no_changes";
      } else {
        mergeCommit = mergeBranch(root, task.branch!, task.base_branch!, `${task.id}: ${task.title}`);
      }
      try {
        diff = mergeCommit ? diffStat(root, `${mergeCommit}~1`, mergeCommit) : "";
      } catch {
        diff = "";
      }
    } catch (error) {
      effectiveClosure = "merge_conflict";
      task.merge_error = error instanceof Error ? error.message : "Unknown merge failure";
    }
  }

  const preserveDebugState = effectiveClosure === "merge_conflict" || effectiveClosure === "failed_subtask";

  if (!preserveDebugState) {
    for (const agent of agents) {
      if (agent.session_cwd && existsSync(agent.session_cwd)) {
        const target = path.join(archiveRoot, `${agent.role}-${agent.id}`);
        archiveSessionDir(agent.session_cwd, target);
        archivePath = archiveRoot;
        // Re-load: the pool's exit handler may have written cli_session_id / metrics
        // after we killed the process. The `agent` snapshot from line 66 is stale.
        const fresh = (await store.loadAgent(agent.id)) ?? agent;
        const now = new Date().toISOString();
        await store.saveAgent({ ...fresh, session_cwd: target, status: "dead", finished_at: fresh.finished_at ?? now, last_activity_at: now });
      }
    }
  }

  if (config.git?.removeWorktreeOnArchive !== false && gitEnabled && task.worktree_path && existsSync(task.worktree_path) && !preserveDebugState) {
    try {
      removeWorktree(root, task.worktree_path);
    } catch {}
  }

  const findings = subtasks.flatMap((subtask) => subtask.findings?.map((finding) => finding.description) ?? []);
  task = {
    ...(await store.loadTask(taskId)),
    status: effectiveClosure === "merge_conflict" || effectiveClosure === "failed_subtask" ? "failed" : "done",
    closure_reason: effectiveClosure,
    merge_commit: mergeCommit,
    merge_error: task.merge_error,
    merged_at: mergeCommit ? new Date().toISOString() : task.merged_at,
    archive_path: archivePath ?? task.archive_path,
    worktree_path: !preserveDebugState && task.worktree_path && !existsSync(task.worktree_path) ? undefined : task.worktree_path,
    updated_at: new Date().toISOString(),
  };
  await store.saveTask(task);
  await Bun.write(store.crewPath("tasks", `${taskId}.md`), summaryMarkdown(task, subtasks, diff, findings));
  if (mergeCommit && task.branch) {
    bus.publish({ tags: [task.id, task.branch], payload: { type: "task_merged", taskId, mergeCommit, branch: task.branch } });
  }
  if (archivePath) {
    bus.publish({ tags: [taskId], payload: { type: "task_archived", taskId, agents: agents.map((agent) => agent.id) } });
  }
  return task;
};

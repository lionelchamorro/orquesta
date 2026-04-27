import { newAgentId } from "../core/ids";
import type { Agent, CliName, Role } from "../core/types";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";
import { argvFor, parseLineFor } from "./adapters";
import type { StreamLogEvent } from "./adapters";
import { seedSession } from "./seed";
import { AgentTerminal } from "./terminal";

export class AgentPool {
  private terminals = new Map<string, AgentTerminal>();
  private exitCodes = new Map<string, number>();
  private outputBuffers = new Map<string, string>();
  private lineBuffers = new Map<string, string>();
  private agentMetrics = new Map<string, Partial<StreamLogEvent>>();
  private readonly maxBufferSize = 200_000;

  constructor(
    private readonly root: string,
    private readonly store: PlanStore,
    private readonly bus: Bus,
    private readonly options: { mcpPort?: number; templatesDir?: string; mcpToken?: string } = {},
  ) {}

  async spawn(role: Role, cli: CliName, model: string, subtaskPrompt: string, options: { taskId?: string; subtaskId?: string; command?: string[]; port?: number; sessionDir?: string } = {}) {
    const id = newAgentId();
    const { dir: cwd, roleTemplate, env } = await seedSession(this.root, id, role, subtaskPrompt, {
      cli,
      port: options.port ?? this.options.mcpPort,
      sessionDir: options.sessionDir,
      templatesDir: this.options.templatesDir,
      sessionToken: this.options.mcpToken,
    });
    const extraArgs = cli === "claude" ? ["--append-system-prompt", roleTemplate] : [];
    const agent: Agent = {
      id,
      role,
      cli,
      model,
      status: "live",
      session_cwd: cwd,
      bound_subtask: options.subtaskId,
      bound_task: options.taskId,
      started_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
    };
    await this.store.saveAgent(agent);
    const terminal = new AgentTerminal(
      id,
      options.command ?? argvFor(cli, model, extraArgs, subtaskPrompt),
      cwd,
      (chunk) => {
        const text = new TextDecoder().decode(chunk);
        const current = this.outputBuffers.get(id) ?? "";
        const next = `${current}${text}`.slice(-this.maxBufferSize);
        this.outputBuffers.set(id, next);
        const lineBuf = (this.lineBuffers.get(id) ?? "") + text;
        const lines = lineBuf.split("\n");
        const remainder = lines.pop() ?? "";
        this.lineBuffers.set(id, remainder);
        for (const line of lines) {
          const evt = parseLineFor(cli, line);
          if (!evt) continue;
          const merged = { ...(this.agentMetrics.get(id) ?? {}), ...evt };
          this.agentMetrics.set(id, merged);
        }
        this.bus.publish({
          tags: [id, role, options.taskId ?? "", options.subtaskId ?? ""].filter(Boolean),
          payload: { type: "subtask_output", subtaskId: options.subtaskId ?? "", chunk: text },
        });
      },
      env,
    );
    this.terminals.set(id, terminal);
    if (options.taskId && options.subtaskId) {
      this.bus.publish({
        tags: [id, options.taskId, options.subtaskId, role],
        payload: { type: "subtask_started", taskId: options.taskId, subtaskId: options.subtaskId, agentId: id },
      });
    }
    terminal.exited.then(async () => {
      const exitCode = await terminal.exited;
      this.exitCodes.set(id, exitCode);
      const tail = this.lineBuffers.get(id);
      if (tail) {
        const evt = parseLineFor(cli, tail);
        if (evt) {
          const merged = { ...(this.agentMetrics.get(id) ?? {}), ...evt };
          this.agentMetrics.set(id, merged);
        }
        this.lineBuffers.delete(id);
      }
      const metrics = this.agentMetrics.get(id) ?? {};
      const current = await this.store.loadAgent(id);
      if (!current) return;
      await this.store.saveAgent({
        ...current,
        status: "dead",
        last_activity_at: new Date().toISOString(),
        exit_code: exitCode,
        ...(metrics.session_id ? { cli_session_id: metrics.session_id } : {}),
        ...(metrics.stop_reason ? { stop_reason: metrics.stop_reason } : {}),
        ...(metrics.total_cost_usd !== undefined ? { total_cost_usd: metrics.total_cost_usd } : {}),
        ...(metrics.duration_ms !== undefined ? { duration_ms: metrics.duration_ms } : {}),
        ...(metrics.num_turns !== undefined ? { num_turns: metrics.num_turns } : {}),
        ...(metrics.final_text ? { final_text: metrics.final_text } : {}),
        ...(metrics.is_error !== undefined ? { is_error: metrics.is_error } : {}),
      });
      this.terminals.delete(id);
    });
    return agent;
  }

  write(agentId: string, data: string | Uint8Array) {
    this.terminals.get(agentId)?.write(data);
  }

  resize(agentId: string, cols: number, rows: number) {
    this.terminals.get(agentId)?.resize(cols, rows);
  }

  kill(agentId: string) {
    this.terminals.get(agentId)?.kill();
  }

  get(agentId: string) {
    return this.terminals.get(agentId);
  }

  waitForExit(agentId: string) {
    const terminal = this.terminals.get(agentId);
    if (terminal) return terminal.exited;
    if (this.exitCodes.has(agentId)) return Promise.resolve(this.exitCodes.get(agentId)!);
    return new Promise<number>(() => {});
  }

  getOutputBuffer(agentId: string) {
    return this.outputBuffers.get(agentId) ?? "";
  }

  list() {
    return Array.from(this.terminals.keys());
  }
}

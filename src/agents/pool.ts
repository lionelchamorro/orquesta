import { newAgentId } from "../core/ids";
import type { Agent, CliName, Role } from "../core/types";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";
import { argvFor, argvForResume, parseLineFor, supportsResume } from "./adapters";
import type { StreamLogEvent } from "./adapters";
import { seedSession } from "./seed";
import { AgentTerminal } from "./terminal";

type TtyListener = (chunk: Uint8Array) => void;

export class AgentPool {
  private terminals = new Map<string, AgentTerminal>();
  private exitCodes = new Map<string, number>();
  private outputBuffers = new Map<string, Uint8Array>();
  private lineBuffers = new Map<string, string>();
  private agentMetrics = new Map<string, Partial<StreamLogEvent>>();
  private ttyListeners = new Map<string, Set<TtyListener>>();
  private readonly maxBufferSize = 200_000;

  constructor(
    private readonly root: string,
    private readonly store: PlanStore,
    private readonly bus: Bus,
    private readonly options: { mcpPort?: number; templatesDir?: string; mcpToken?: string } = {},
  ) {}

  async spawn(role: Role, cli: CliName, model: string, subtaskPrompt: string, options: { taskId?: string; subtaskId?: string; command?: string[]; port?: number; sessionDir?: string } = {}) {
    const id = newAgentId();
    const { dir: cwd, env } = await seedSession(this.root, id, role, subtaskPrompt, {
      cli,
      port: options.port ?? this.options.mcpPort,
      sessionDir: options.sessionDir,
      templatesDir: this.options.templatesDir,
      sessionToken: this.options.mcpToken,
    });
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
    const decoder = new TextDecoder("utf-8", { fatal: false });
    const argv = options.command
      ? (subtaskPrompt ? [...options.command, subtaskPrompt] : options.command)
      : argvFor(cli, model, [], subtaskPrompt);
    const terminal = new AgentTerminal(
      id,
      argv,
      cwd,
      (chunk) => {
        this.appendOutputBuffer(id, chunk);
        const listeners = this.ttyListeners.get(id);
        if (listeners) {
          for (const listener of listeners) {
            try { listener(chunk); } catch {}
          }
        }
        const text = decoder.decode(chunk, { stream: true });
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
      const flushed = decoder.decode();
      const tail = (this.lineBuffers.get(id) ?? "") + flushed;
      if (tail) {
        for (const line of tail.split("\n")) {
          const evt = parseLineFor(cli, line);
          if (!evt) continue;
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

  private appendOutputBuffer(agentId: string, chunk: Uint8Array) {
    const current = this.outputBuffers.get(agentId);
    const combined = new Uint8Array((current?.byteLength ?? 0) + chunk.byteLength);
    if (current) combined.set(current, 0);
    combined.set(chunk, current?.byteLength ?? 0);
    this.outputBuffers.set(agentId, combined.byteLength > this.maxBufferSize ? combined.slice(-this.maxBufferSize) : combined);
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

  getOutputBuffer(agentId: string) {
    return this.outputBuffers.get(agentId) ?? new Uint8Array();
  }

  waitForExit(agentId: string) {
    const terminal = this.terminals.get(agentId);
    if (terminal) return terminal.exited;
    if (this.exitCodes.has(agentId)) return Promise.resolve(this.exitCodes.get(agentId)!);
    return new Promise<number>(() => {});
  }

  subscribeTty(agentId: string, listener: TtyListener): () => void {
    let listeners = this.ttyListeners.get(agentId);
    if (!listeners) {
      listeners = new Set();
      this.ttyListeners.set(agentId, listeners);
    }
    listeners.add(listener);
    return () => {
      const set = this.ttyListeners.get(agentId);
      if (!set) return;
      set.delete(listener);
      if (set.size === 0) this.ttyListeners.delete(agentId);
    };
  }

  list() {
    return Array.from(this.terminals.keys());
  }

  // Spawns a transient PTY that resumes the original agent's CLI conversation by session id.
  // The resume terminal lives under the synthetic key `${originalAgentId}:resume` and reuses
  // write/resize/kill/subscribeTty without touching the orchestration plumbing — it is purely
  // a viewer for a finished/crashed agent's session.
  async startResume(originalAgentId: string): Promise<string> {
    const original = await this.store.loadAgent(originalAgentId);
    if (!original) throw new Error(`unknown agent ${originalAgentId}`);
    if (!supportsResume(original.cli)) throw new Error(`resume not supported for cli ${original.cli}`);
    if (!original.cli_session_id) throw new Error("agent has no captured cli_session_id");
    if (!original.session_cwd) throw new Error("agent has no session_cwd");
    const key = `${originalAgentId}:resume`;
    const existing = this.terminals.get(key);
    if (existing) return key;
    const cmd = argvForResume(original.cli, original.model, original.cli_session_id);
    const terminal = new AgentTerminal(
      key,
      cmd,
      original.session_cwd,
      (chunk) => {
        const listeners = this.ttyListeners.get(key);
        if (!listeners) return;
        for (const listener of listeners) {
          try { listener(chunk); } catch {}
        }
      },
    );
    this.terminals.set(key, terminal);
    terminal.exited.then(() => {
      this.terminals.delete(key);
      this.ttyListeners.delete(key);
    });
    return key;
  }
}

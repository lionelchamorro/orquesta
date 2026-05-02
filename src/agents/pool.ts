import { newAgentId } from "../core/ids";
import type { Agent, CliName, Role, TeamMember } from "../core/types";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";
import { argvFor, argvForResume, parseLineFor, supportsResume } from "./adapters";
import type { StreamLogEvent } from "./adapters";
import { detectRateLimit, type RateLimitInfo } from "./rate-limit";
import { seedSession } from "./seed";
import { AgentTerminal } from "./terminal";

type TtyListener = (chunk: Uint8Array) => void;

export class AgentPool {
  private terminals = new Map<string, AgentTerminal>();
  private exitCodes = new Map<string, number>();
  private outputBuffers = new Map<string, Uint8Array>();
  private lineBuffers = new Map<string, string>();
  private eventLineBuffers = new Map<string, string>();
  private agentMetrics = new Map<string, Partial<StreamLogEvent>>();
  private rateLimits = new Map<string, RateLimitInfo>();
  readonly unavailableUntil = new Map<string, string>();
  // Tracks agents currently in the exit handler so chunk-driven last_event_at
  // updates do not race with the final saveAgent.
  private exitingAgents = new Set<string>();
  // Throttle for chunk-driven last_event_at writes — at most one disk write
  // per second per agent (see issue 007).
  private lastEventWrites = new Map<string, number>();
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
        const text = new TextDecoder().decode(chunk);
        this.appendOutputBuffer(id, chunk);
        const tailText = new TextDecoder("utf-8", { fatal: false }).decode(this.outputBuffers.get(id) ?? new Uint8Array());
        const rateLimit = detectRateLimit(text) ?? detectRateLimit(tailText);
        if (rateLimit) {
          this.rateLimits.set(id, rateLimit);
          if (rateLimit.reset_at) this.markUnavailable(cli, model, rateLimit.reset_at);
        }
        this.broadcastTty(id, chunk);
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
        this.publishOutputLines(id, role, text, options);
        void this.bumpLastEventAt(id);
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
      this.exitingAgents.add(id);
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
      const outputTail = this.eventLineBuffers.get(id);
      if (outputTail) {
        this.publishOutput(id, role, outputTail, options);
        this.eventLineBuffers.delete(id);
      }
      const metrics = this.agentMetrics.get(id) ?? {};
      const current = await this.store.loadAgent(id);
      if (!current) return;
      const finishedAt = new Date().toISOString();
      await this.store.saveAgent({
        ...current,
        status: "dead",
        finished_at: finishedAt,
        last_activity_at: finishedAt,
        last_event_at: current.last_event_at ?? finishedAt,
        exit_code: exitCode,
        ...(metrics.session_id ? { cli_session_id: metrics.session_id } : {}),
        ...(metrics.stop_reason ? { stop_reason: metrics.stop_reason } : {}),
        ...(metrics.total_cost_usd !== undefined ? { total_cost_usd: metrics.total_cost_usd } : {}),
        ...(metrics.duration_ms !== undefined ? { duration_ms: metrics.duration_ms } : {}),
        ...(metrics.num_turns !== undefined ? { num_turns: metrics.num_turns } : {}),
        ...(metrics.final_text ? { final_text: metrics.final_text } : {}),
        ...(metrics.is_error !== undefined ? { is_error: metrics.is_error } : {}),
        ...(this.rateLimits.get(id)?.reset_at ? { quota_reset_at: this.rateLimits.get(id)!.reset_at } : {}),
      });
      this.terminals.delete(id);
      this.lastEventWrites.delete(id);
      this.exitingAgents.delete(id);
    });
    return agent;
  }

  async spawnConsultant(role: Extract<Role, "pm" | "architect">, member: TeamMember, context: { iterationId: string; prompt: string }) {
    const selected = this.nextAvailable(member);
    if (!selected) return null;
    const agent = await this.spawn(role, selected.cli, selected.model, context.prompt, {
      command: selected.command,
    });
    await this.store.saveAgent({ ...agent, bound_iteration: context.iterationId });
    return { ...agent, bound_iteration: context.iterationId };
  }

  async getConsultant(role: Extract<Role, "pm" | "architect">, iterationId: string) {
    const agents = await this.store.loadAgents();
    return agents.find((agent) => agent.role === role && agent.bound_iteration === iterationId && agent.status !== "dead") ?? null;
  }

  write(agentId: string, data: string | Uint8Array) {
    this.terminals.get(agentId)?.write(data);
  }

  private broadcastTty(agentId: string, chunk: Uint8Array) {
    const listeners = this.ttyListeners.get(agentId);
    if (!listeners) return;
    for (const listener of listeners) {
      try { listener(chunk); } catch {}
    }
  }

  private appendOutputBuffer(agentId: string, chunk: Uint8Array) {
    const current = this.outputBuffers.get(agentId);
    const combined = new Uint8Array((current?.byteLength ?? 0) + chunk.byteLength);
    if (current) combined.set(current, 0);
    combined.set(chunk, current?.byteLength ?? 0);
    this.outputBuffers.set(agentId, combined.byteLength > this.maxBufferSize ? combined.slice(-this.maxBufferSize) : combined);
  }

  private publishOutputLines(agentId: string, role: Role, text: string, options: { taskId?: string; subtaskId?: string }) {
    const buffered = (this.eventLineBuffers.get(agentId) ?? "") + text;
    const lines = buffered.split("\n");
    const remainder = lines.pop() ?? "";
    this.eventLineBuffers.set(agentId, remainder);
    for (const line of lines) {
      this.publishOutput(agentId, role, `${line}\n`, options);
    }
  }

  private publishOutput(agentId: string, role: Role, chunk: string, options: { taskId?: string; subtaskId?: string }) {
    if (options.subtaskId) {
      this.bus.publish({
        tags: [agentId, role, options.taskId ?? "", options.subtaskId].filter(Boolean),
        payload: { type: "subtask_output", subtaskId: options.subtaskId, chunk },
      });
      return;
    }
    this.bus.publish({
      tags: [agentId, role, options.taskId ?? ""].filter(Boolean),
      payload: { type: "agent_output", agentId, chunk },
    });
  }

  private async bumpLastEventAt(agentId: string) {
    const nowMs = Date.now();
    const previous = this.lastEventWrites.get(agentId) ?? 0;
    if (nowMs - previous < 1_000) return;
    this.lastEventWrites.set(agentId, nowMs);
    if (this.exitingAgents.has(agentId)) return;
    const current = await this.store.loadAgent(agentId);
    if (!current || current.status === "dead" || this.exitingAgents.has(agentId)) return;
    await this.store.saveAgent({ ...current, last_event_at: new Date(nowMs).toISOString() });
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

  getRateLimit(agentId: string) {
    const cached = this.rateLimits.get(agentId);
    if (cached) return cached;
    const buffer = this.getOutputBuffer(agentId);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(buffer);
    return detectRateLimit(text);
  }

  markUnavailable(cli: CliName, model: string, resetAt: string) {
    this.unavailableUntil.set(`${cli}:${model}`, resetAt);
  }

  nextAvailable(member: TeamMember, now = new Date()): Omit<TeamMember, "role" | "fallbacks"> | null {
    const candidates = [
      { cli: member.cli, model: member.model, command: member.command },
      ...(member.fallbacks ?? []),
    ];
    for (const candidate of candidates) {
      const blockedUntil = this.unavailableUntil.get(`${candidate.cli}:${candidate.model}`);
      if (!blockedUntil || Date.parse(blockedUntil) <= now.getTime()) return candidate;
    }
    return null;
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

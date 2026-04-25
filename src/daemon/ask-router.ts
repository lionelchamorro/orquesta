import type { AgentPool } from "../agents/pool";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";

const ASK_TIMEOUT_MS = Number(Bun.env.ASK_USER_TIMEOUT_MS ?? 300_000);
export const HUMAN_FALLBACK_AGENT_ID = "human-fallback";

export class AskRouter {
  private pending = new Map<string, { resolve: (answer: string) => void; timer: Timer; fromAgent: string; question: string; options?: string[] }>();

  constructor(
    private readonly store: PlanStore,
    private readonly pool: AgentPool,
    private readonly bus: Bus,
  ) {}

  async ask(fromAgent: string, question: string, options?: string[]) {
    const askId = crypto.randomUUID();
    const agents = await this.store.loadAgents();
    const pm = agents.find((agent) => agent.role === "pm" && agent.status !== "dead");
    const initialFallback = !pm;

    return await new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(askId);
        if (!initialFallback) {
          this.bus.publish({ tags: [fromAgent, askId], payload: { type: "ask_user", askId, fromAgent, question, options, fallback: true } });
        }
        resolve("Pending human answer");
      }, ASK_TIMEOUT_MS);
      this.pending.set(askId, { resolve, timer, fromAgent, question, options });
      this.bus.publish({ tags: [fromAgent, askId], payload: { type: "ask_user", askId, fromAgent, question, options, fallback: initialFallback } });
      if (pm) {
        this.pool.write(pm.id, `[ORQ] question from ${fromAgent}: ${question} [askId=${askId}]\n`);
      }
    });
  }

  async answer(askId: string, answer: string, fromAgent: string) {
    if (fromAgent !== HUMAN_FALLBACK_AGENT_ID) {
      const agents = await this.store.loadAgents();
      const agent = agents.find((item) => item.id === fromAgent);
      if (!agent || agent.role !== "pm") {
        throw new Error("Only pm agent can answer");
      }
    }
    const pending = this.pending.get(askId);
    if (!pending) throw new Error("Unknown or already answered ask");
    clearTimeout(pending.timer);
    this.pending.delete(askId);
    pending.resolve(answer);
    this.bus.publish({ tags: [fromAgent, askId], payload: { type: "ask_user_answered", askId, answer, fromAgent } });
  }

  close() {
    for (const [askId, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.resolve(`ask ${askId} closed`);
    }
    this.pending.clear();
  }
}

import type { AgentPool } from "../agents/pool";
import type { Bus } from "../bus/bus";
import type { PlanStore } from "../core/plan-store";

const ASK_TIMEOUT_MS = Number(Bun.env.ASK_USER_TIMEOUT_MS ?? 300_000);
const ASK_HARD_TIMEOUT_MS = Number(Bun.env.ASK_USER_HARD_TIMEOUT_MS ?? 3_600_000);
export const HUMAN_FALLBACK_AGENT_ID = "human-fallback";

export class AskRouter {
  private pending = new Map<string, {
    resolve: (answer: string) => void;
    fallbackTimer: Timer;
    hardTimer: Timer;
    fromAgent: string;
    question: string;
    options?: string[];
  }>();

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
    const now = new Date().toISOString();
    await this.store.savePendingAsk({
      id: askId,
      fromAgent,
      question,
      options,
      status: initialFallback ? "fallback" : "pending",
      created_at: now,
      updated_at: now,
    });

    return await new Promise<string>((resolve) => {
      const fallbackTimer = setTimeout(() => {
        if (!initialFallback) {
          void this.markFallback(askId);
          this.bus.publish({ tags: [fromAgent, askId], payload: { type: "ask_user", askId, fromAgent, question, options, fallback: true } });
        }
      }, ASK_TIMEOUT_MS);
      const hardTimer = setTimeout(() => {
        this.pending.delete(askId);
        void this.store.savePendingAsk({
          id: askId,
          fromAgent,
          question,
          options,
          status: "timed_out",
          created_at: now,
          updated_at: new Date().toISOString(),
        });
        this.bus.publish({ tags: [fromAgent, askId], payload: { type: "ask_timed_out", askId, fromAgent } });
        resolve(
          `[ORQ] No human/PM response received within ${Math.round(ASK_HARD_TIMEOUT_MS / 60_000)}min. Proceed using your best judgment, document the assumption you made and the rationale in your report_complete summary.`,
        );
      }, ASK_HARD_TIMEOUT_MS);
      this.pending.set(askId, { resolve, fallbackTimer, hardTimer, fromAgent, question, options });
      this.bus.publish({ tags: [fromAgent, askId], payload: { type: "ask_user", askId, fromAgent, question, options, fallback: initialFallback } });
      if (pm) {
        this.pool.write(pm.id, `[ORQ] question from ${fromAgent}: ${question} [askId=${askId}]\n`);
      }
    });
  }

  async recoverPendingAsks() {
    for (const ask of await this.store.loadPendingAsks()) {
      if (ask.status !== "pending" && ask.status !== "fallback") continue;
      this.bus.publish({
        tags: [ask.fromAgent, ask.id],
        payload: { type: "ask_user", askId: ask.id, fromAgent: ask.fromAgent, question: ask.question, options: ask.options, fallback: true },
      });
      await this.store.savePendingAsk({ ...ask, status: "fallback", updated_at: new Date().toISOString() });
    }
  }

  private async markFallback(askId: string) {
    const ask = await this.store.loadPendingAsk(askId);
    if (!ask || ask.status === "answered" || ask.status === "timed_out") return;
    await this.store.savePendingAsk({ ...ask, status: "fallback", updated_at: new Date().toISOString() });
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
    const ask = await this.store.loadPendingAsk(askId);
    if (!pending && (!ask || ask.status === "answered" || ask.status === "timed_out")) throw new Error("Unknown or already answered ask");
    if (pending) {
      clearTimeout(pending.fallbackTimer);
      clearTimeout(pending.hardTimer);
      this.pending.delete(askId);
      pending.resolve(answer);
    }
    if (ask) {
      await this.store.savePendingAsk({
        ...ask,
        status: "answered",
        answer,
        answered_by: fromAgent,
        updated_at: new Date().toISOString(),
      });
    }
    const tags = ask ? [fromAgent, ask.fromAgent, askId] : [fromAgent, askId];
    this.bus.publish({ tags, payload: { type: "ask_user_answered", askId, answer, fromAgent } });
  }

  close() {
    for (const [askId, pending] of this.pending) {
      clearTimeout(pending.fallbackTimer);
      clearTimeout(pending.hardTimer);
      pending.resolve(`ask ${askId} closed`);
    }
    this.pending.clear();
  }
}

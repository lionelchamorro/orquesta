import { newEventId } from "../core/ids";
import type { TaggedBusEvent } from "../core/types";
import type { Journal } from "./journal";

type TagFilter = string | string[] | ((tags: string[]) => boolean);
type Handler = (event: TaggedBusEvent) => void;

const matches = (filter: TagFilter, tags: string[]) => {
  if (typeof filter === "function") return filter(tags);
  if (typeof filter === "string") return tags.includes(filter);
  return filter.some((item) => tags.includes(item));
};

// dedupKeys is a small list of (type, payload-key) pairs whose events are
// idempotent and tolerate late-arriving retries. Keyed events received
// within DEDUP_WINDOW_MS of the first observation are silently dropped.
type DedupKey = [string, string];
const DEDUP_KEYS: DedupKey[] = [
  ["subtask_completed", "subtaskId"],
  ["agent_completed", "agentId"],
];
const DEDUP_WINDOW_MS = 5_000;

const dedupKeyFor = (event: TaggedBusEvent): string | null => {
  for (const [type, field] of DEDUP_KEYS) {
    if (event.payload.type === type) {
      const value = (event.payload as Record<string, unknown>)[field];
      if (typeof value === "string" && value.length > 0) return `${type}:${value}`;
    }
  }
  return null;
};

export class Bus {
  private subscribers = new Set<{ filter: TagFilter; handler: Handler }>();
  private recentDedup = new Map<string, number>();

  constructor(private readonly options: { journal?: Journal } = {}) {}

  subscribe(filter: TagFilter, handler: Handler) {
    const subscriber = { filter, handler };
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  publish(event: Omit<TaggedBusEvent, "id" | "ts"> & Partial<Pick<TaggedBusEvent, "id" | "ts">>) {
    const tagged: TaggedBusEvent = {
      id: event.id ?? newEventId(),
      ts: event.ts ?? new Date().toISOString(),
      tags: event.tags,
      payload: event.payload,
    };
    // Reject ill-formed subtask_output (empty subtaskId): the producer should
    // have emitted agent_output for the planner / unbound agents instead.
    if (tagged.payload.type === "subtask_output" && !tagged.payload.subtaskId) {
      return tagged;
    }
    const key = dedupKeyFor(tagged);
    if (key) {
      const now = Date.now();
      const last = this.recentDedup.get(key);
      if (last !== undefined && now - last < DEDUP_WINDOW_MS) {
        return tagged;
      }
      this.recentDedup.set(key, now);
      // Keep the dedup map bounded; drop entries that have aged out.
      if (this.recentDedup.size > 256) {
        for (const [k, ts] of this.recentDedup) {
          if (now - ts >= DEDUP_WINDOW_MS) this.recentDedup.delete(k);
        }
      }
    }
    this.options.journal?.append(tagged);
    for (const subscriber of this.subscribers) {
      if (!matches(subscriber.filter, tagged.tags)) continue;
      try {
        subscriber.handler(tagged);
      } catch (error) {
        console.error("bus subscriber failed", error);
      }
    }
    return tagged;
  }
}

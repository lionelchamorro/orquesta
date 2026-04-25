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

export class Bus {
  private subscribers = new Set<{ filter: TagFilter; handler: Handler }>();

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

import { Database } from "bun:sqlite";
import type { TaggedBusEvent } from "../core/types";

export class Journal {
  private db: Database;

  constructor(filePath: string) {
    this.db = new Database(filePath, { create: true });
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL,
        ts TEXT NOT NULL,
        type TEXT NOT NULL,
        tags TEXT NOT NULL,
        payload TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
    `);
  }

  append(event: TaggedBusEvent) {
    this.db
      .query("INSERT INTO events (event_id, ts, type, tags, payload) VALUES (?, ?, ?, ?, ?)")
      .run(event.id, event.ts, event.payload.type, JSON.stringify(event.tags), JSON.stringify(event.payload));
  }

  query(params: { tagsIncludes?: string; sinceId?: number; limit?: number } = {}) {
    const clauses: string[] = [];
    const values: Array<number | string> = [];
    if (params.sinceId !== undefined) {
      clauses.push("id > ?");
      values.push(params.sinceId);
    }
    if (params.tagsIncludes) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(events.tags) WHERE json_each.value = ?)");
      values.push(params.tagsIncludes);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const limit = params.limit ?? 100;
    return this.db
      .query(`SELECT id, event_id, ts, tags, payload FROM events ${where} ORDER BY id ASC LIMIT ${limit}`)
      .all(...values)
      .map((row) => ({
        id: String((row as Record<string, unknown>).event_id),
        ts: String((row as Record<string, unknown>).ts),
        tags: JSON.parse(String((row as Record<string, unknown>).tags)) as string[],
        payload: JSON.parse(String((row as Record<string, unknown>).payload)),
        journal_id: Number((row as Record<string, unknown>).id),
      }));
  }

  close() {
    this.db.close();
  }
}

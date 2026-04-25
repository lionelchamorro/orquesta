import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Journal } from "../bus/journal";

test("journal appends and queries events", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-journal-"));
  const journal = new Journal(path.join(root, "journal.sqlite"));
  journal.append({ id: "1", ts: "2020-01-01", tags: ["task-1"], payload: { type: "task_ready", taskId: "task-1" } });
  journal.append({ id: "2", ts: "2020-01-02", tags: ["task-2"], payload: { type: "task_ready", taskId: "task-2" } });
  expect(journal.query({ tagsIncludes: "task-1" }).length).toBe(1);
  journal.close();
  rmSync(root, { recursive: true, force: true });
});

test("journal tag filtering does not collide on prefixes", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-journal-tags-"));
  const journal = new Journal(path.join(root, "journal.sqlite"));
  journal.append({ id: "1", ts: "2020-01-01", tags: ["iter-1"], payload: { type: "task_ready", taskId: "task-1" } });
  journal.append({ id: "2", ts: "2020-01-02", tags: ["iter-10"], payload: { type: "task_ready", taskId: "task-2" } });
  expect(journal.query({ tagsIncludes: "iter-1" }).map((event) => event.id)).toEqual(["1"]);
  journal.close();
  rmSync(root, { recursive: true, force: true });
});

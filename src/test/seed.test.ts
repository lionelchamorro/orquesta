import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { seedSession } from "../agents/seed";

test("seedSession writes CLAUDE and mcp config", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-seed-"));
  mkdirSync(path.join(root, "templates", "roles"), { recursive: true });
  await Bun.write(path.join(root, "templates", "roles", "coder.md"), "coder role");
  await Bun.write(path.join(root, "templates", "mcp.json.tmpl"), "{\"url\":\"http://localhost:{{PORT}}/mcp/{{SESSION_ID}}\"}");
  const { dir: cwd, roleTemplate } = await seedSession(root, "agent-1", "coder", "do work");
  expect(await Bun.file(path.join(cwd, "CLAUDE.md")).text()).toContain("do work");
  expect(await Bun.file(path.join(cwd, ".mcp.json")).text()).toContain("agent-1");
  expect(roleTemplate).toBe("coder role");
  rmSync(root, { recursive: true, force: true });
});

test("seedSession uses explicit port override", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-seed-port-"));
  mkdirSync(path.join(root, "templates", "roles"), { recursive: true });
  await Bun.write(path.join(root, "templates", "roles", "coder.md"), "coder role");
  await Bun.write(path.join(root, "templates", "mcp.json.tmpl"), "{\"url\":\"http://localhost:{{PORT}}/mcp/{{SESSION_ID}}\"}");
  const { dir: cwd } = await seedSession(root, "agent-2", "coder", "do work", { port: 9123 });
  expect(await Bun.file(path.join(cwd, ".mcp.json")).text()).toContain("9123");
  rmSync(root, { recursive: true, force: true });
});

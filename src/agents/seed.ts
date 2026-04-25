import { mkdirSync } from "node:fs";
import path from "node:path";
import type { Role } from "../core/types";

const renderTemplate = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

export const seedSession = async (
  root: string,
  agentId: string,
  role: Role,
  subtaskPrompt: string,
  options: { port?: number; sessionDir?: string; templatesDir?: string } = {},
) => {
  const dir = options.sessionDir ?? path.join(root, ".orquesta", "crew", "sessions", agentId);
  mkdirSync(dir, { recursive: true });
  const templatesDir = options.templatesDir ?? path.join(root, "templates");
  const roleTemplate = await Bun.file(path.join(templatesDir, "roles", `${role}.md`)).text();
  const mcpTemplate = await Bun.file(path.join(templatesDir, "mcp.json.tmpl")).text();
  const port = String(options.port ?? Bun.env.ORQ_PORT ?? "8000");
  await Bun.write(path.join(dir, "CLAUDE.md"), `${roleTemplate}\n\n## Current Subtask\n\n${subtaskPrompt}\n`);
  await Bun.write(path.join(dir, ".mcp.json"), renderTemplate(mcpTemplate, { PORT: port, SESSION_ID: agentId }));
  return { dir, roleTemplate };
};

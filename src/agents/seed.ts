import { mkdirSync } from "node:fs";
import path from "node:path";
import type { CliName, Role } from "../core/types";

const renderTemplate = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

const tomlString = (value: string) => JSON.stringify(value);

export const seedSession = async (
  root: string,
  agentId: string,
  role: Role,
  subtaskPrompt: string,
  options: { cli?: CliName; port?: number; sessionDir?: string; templatesDir?: string; sessionToken?: string } = {},
) => {
  const dir = options.sessionDir ?? path.join(root, ".orquesta", "crew", "sessions", agentId);
  mkdirSync(dir, { recursive: true });
  const templatesDir = options.templatesDir ?? path.join(root, "templates");
  const roleTemplate = await Bun.file(path.join(templatesDir, "roles", `${role}.md`)).text();
  const mcpTemplate = await Bun.file(path.join(templatesDir, "mcp.json.tmpl")).text();
  const port = String(options.port ?? Bun.env.ORQ_PORT ?? "8000");
  const mcpUrl = `http://localhost:${port}/mcp/${agentId}${options.sessionToken ? `?token=${encodeURIComponent(options.sessionToken)}` : ""}`;
  const instructions = `${roleTemplate}\n\n## Current Subtask\n\n${subtaskPrompt}\n`;
  await Bun.write(path.join(dir, "CLAUDE.md"), instructions);
  await Bun.write(path.join(dir, "AGENTS.md"), instructions);
  await Bun.write(path.join(dir, "GEMINI.md"), instructions);
  await Bun.write(
    path.join(dir, ".mcp.json"),
    renderTemplate(mcpTemplate, { PORT: port, SESSION_ID: agentId, SESSION_TOKEN: options.sessionToken ?? "" }),
  );
  const codexHome = path.join(dir, ".codex");
  mkdirSync(codexHome, { recursive: true });
  await Bun.write(
    path.join(codexHome, "config.toml"),
    [
      `[projects.${tomlString(dir)}]`,
      `trust_level = "trusted"`,
      "",
      `[projects.${tomlString(root)}]`,
      `trust_level = "trusted"`,
      "",
      "[mcp_servers.orquesta]",
      `url = ${tomlString(mcpUrl)}`,
      "",
    ].join("\n"),
  );
  mkdirSync(path.join(dir, ".gemini"), { recursive: true });
  await Bun.write(
    path.join(dir, ".gemini", "settings.json"),
    JSON.stringify({
      mcpServers: {
        orquesta: {
          httpUrl: mcpUrl,
          trust: true,
        },
      },
    }, null, 2),
  );
  const env: Record<string, string> = options.cli === "codex" ? { CODEX_HOME: codexHome } : {};
  return { dir, roleTemplate, env };
};

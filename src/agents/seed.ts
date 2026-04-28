import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CliName, Role } from "../core/types";

const renderTemplate = (template: string, vars: Record<string, string>) =>
  template.replace(/\{\{([A-Z_]+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);

const tomlString = (value: string) => JSON.stringify(value);

const linkCodexAuth = (codexHome: string) => {
  const sourceHome = Bun.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  const sourceAuth = path.join(sourceHome, "auth.json");
  const targetAuth = path.join(codexHome, "auth.json");
  if (!existsSync(sourceAuth) || existsSync(targetAuth)) return;
  try {
    symlinkSync(sourceAuth, targetAuth);
  } catch {
    copyFileSync(sourceAuth, targetAuth);
  }
};

const trustGeminiFolder = (dir: string) => {
  const geminiHome = Bun.env.GEMINI_HOME ?? path.join(os.homedir(), ".gemini");
  const trustFile = path.join(geminiHome, "trustedFolders.json");
  const candidates = new Set<string>([dir]);
  try { candidates.add(realpathSync(dir)); } catch { /* dir may not exist yet */ }
  let current: Record<string, string> = {};
  if (existsSync(trustFile)) {
    try {
      const parsed = JSON.parse(readFileSync(trustFile, "utf8")) as unknown;
      if (parsed && typeof parsed === "object") current = parsed as Record<string, string>;
    } catch { /* corrupt file: overwrite */ }
  }
  let changed = false;
  for (const entry of candidates) {
    if (current[entry] !== "TRUST_FOLDER") {
      current[entry] = "TRUST_FOLDER";
      changed = true;
    }
  }
  if (!changed) return;
  try {
    mkdirSync(geminiHome, { recursive: true });
    writeFileSync(trustFile, `${JSON.stringify(current, null, 2)}\n`);
  } catch { /* best-effort: if we can't write, fall back to the in-session settings */ }
};

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
  if (options.cli === "codex") linkCodexAuth(codexHome);
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
      security: { folderTrust: { enabled: false } },
      mcpServers: {
        orquesta: {
          httpUrl: mcpUrl,
          trust: true,
        },
      },
    }, null, 2),
  );
  if (options.cli === "gemini") trustGeminiFolder(dir);
  const env: Record<string, string> = options.cli === "codex" ? { CODEX_HOME: codexHome } : {};
  return { dir, roleTemplate, env };
};

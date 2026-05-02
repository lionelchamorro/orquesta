import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { installBuildDagSkill, uninstallBuildDagSkill } from "../cli/skill-install";

const templatesDir = path.join(import.meta.dir, "..", "..", "templates");

test("build-dag skill install and uninstall are idempotent for all targets", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "orq-skill-install-"));

  installBuildDagSkill(root, templatesDir, "all");
  installBuildDagSkill(root, templatesDir, "all");

  const claudeSkill = path.join(root, ".claude", "skills", "orquesta-build-dag", "SKILL.md");
  expect(existsSync(claudeSkill)).toBe(true);
  expect(readFileSync(claudeSkill, "utf8")).toContain("orquesta-build-dag");

  const agents = readFileSync(path.join(root, "AGENTS.md"), "utf8");
  const gemini = readFileSync(path.join(root, "GEMINI.md"), "utf8");
  expect(agents.match(/orquesta-build-dag:start/g)).toHaveLength(1);
  expect(gemini.match(/orquesta-build-dag:start/g)).toHaveLength(1);

  uninstallBuildDagSkill(root, "all");
  uninstallBuildDagSkill(root, "all");

  expect(existsSync(claudeSkill)).toBe(false);
  expect(readFileSync(path.join(root, "AGENTS.md"), "utf8")).not.toContain("orquesta-build-dag:start");
  expect(readFileSync(path.join(root, "GEMINI.md"), "utf8")).not.toContain("orquesta-build-dag:start");

  rmSync(root, { recursive: true, force: true });
});

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type SkillTarget = "claude" | "codex" | "gemini" | "all";

const START = "<!-- orquesta-build-dag:start -->";
const END = "<!-- orquesta-build-dag:end -->";

const block = (skillText: string) => `${START}\n## orquesta-build-dag\n\n${skillText.trim()}\n${END}\n`;

const replaceBlock = (current: string, skillText: string) => {
  const nextBlock = block(skillText);
  const pattern = new RegExp(`${START}[\\s\\S]*?${END}\\n?`, "m");
  if (pattern.test(current)) return current.replace(pattern, nextBlock);
  return `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${nextBlock}`;
};

const removeBlock = (current: string) => {
  const pattern = new RegExp(`\\n?${START}[\\s\\S]*?${END}\\n?`, "m");
  return current.replace(pattern, "\n").trimEnd() + (current.trim() ? "\n" : "");
};

const targetsFor = (target: SkillTarget): Exclude<SkillTarget, "all">[] =>
  target === "all" ? ["claude", "codex", "gemini"] : [target];

export const installBuildDagSkill = (root: string, templatesDir: string, target: SkillTarget = "all") => {
  const skillPath = path.join(templatesDir, "build-dag-skill", "SKILL.md");
  const skillText = readFileSync(skillPath, "utf8");
  for (const item of targetsFor(target)) {
    if (item === "claude") {
      const dir = path.join(root, ".claude", "skills", "orquesta-build-dag");
      mkdirSync(dir, { recursive: true });
      copyFileSync(skillPath, path.join(dir, "SKILL.md"));
    } else {
      const file = path.join(root, item === "codex" ? "AGENTS.md" : "GEMINI.md");
      const current = existsSync(file) ? readFileSync(file, "utf8") : "";
      writeFileSync(file, replaceBlock(current, skillText), "utf8");
    }
  }
};

export const uninstallBuildDagSkill = (root: string, target: SkillTarget = "all") => {
  for (const item of targetsFor(target)) {
    if (item === "claude") {
      rmSync(path.join(root, ".claude", "skills", "orquesta-build-dag"), { recursive: true, force: true });
    } else {
      const file = path.join(root, item === "codex" ? "AGENTS.md" : "GEMINI.md");
      if (!existsSync(file)) continue;
      writeFileSync(file, removeBlock(readFileSync(file, "utf8")), "utf8");
    }
  }
};

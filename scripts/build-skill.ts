import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillMarkdown, createSkillOpenAiYaml } from "../src/skill.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(root, "skills", "linear-axi", "SKILL.md");
const openAiPath = join(root, "skills", "linear-axi", "agents", "openai.yaml");

const generated = createSkillMarkdown();
const generatedOpenAi = createSkillOpenAiYaml();

if (process.argv.includes("--check")) {
  const committed = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";
  const committedOpenAi = existsSync(openAiPath) ? readFileSync(openAiPath, "utf8") : "";
  if (committed !== generated || committedOpenAi !== generatedOpenAi) {
    process.stderr.write("linear-axi skill artifacts are stale - run `pnpm run build:skill` and commit\n");
    process.exit(1);
  }
  process.stdout.write("SKILL.md is up to date\n");
} else {
  mkdirSync(dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, generated);
  mkdirSync(dirname(openAiPath), { recursive: true });
  writeFileSync(openAiPath, generatedOpenAi);
  process.stdout.write(`Wrote ${skillPath} and ${openAiPath}\n`);
}

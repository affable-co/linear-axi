import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSkillMarkdown } from "../src/skill.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillPath = join(root, "skills", "linear-axi", "SKILL.md");

const generated = createSkillMarkdown();

if (process.argv.includes("--check")) {
  const committed = existsSync(skillPath) ? readFileSync(skillPath, "utf8") : "";
  if (committed !== generated) {
    process.stderr.write("skills/linear-axi/SKILL.md is stale - run `pnpm run build:skill` and commit\n");
    process.exit(1);
  }
  process.stdout.write("SKILL.md is up to date\n");
} else {
  mkdirSync(dirname(skillPath), { recursive: true });
  writeFileSync(skillPath, generated);
  process.stdout.write(`Wrote ${skillPath}\n`);
}

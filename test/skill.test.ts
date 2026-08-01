import { describe, it, expect } from "vitest";
import {
  createSkillMarkdown,
  createSkillOpenAiYaml,
  extractCommandsBlock,
  SKILL_DESCRIPTION,
} from "../src/skill.js";

/** Pull the raw YAML frontmatter block from a markdown string. */
function frontmatter(markdown: string): string {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error("Missing frontmatter");
  return match[1];
}

describe("createSkillMarkdown", () => {
  const markdown = createSkillMarkdown();

  it("starts with a YAML frontmatter block", () => {
    expect(markdown.startsWith("---\n")).toBe(true);
    expect(() => frontmatter(markdown)).not.toThrow();
  });

  it("uses strict portable frontmatter with only name and description", () => {
    const fm = frontmatter(markdown);
    expect(fm.split("\n").map((line) => line.split(":")[0])).toEqual(["name", "description"]);
  });

  it("has a description that mentions Linear", () => {
    expect(SKILL_DESCRIPTION).toContain("Linear");
    expect(frontmatter(markdown)).toContain("description:");
  });

  it("teaches the npx invocation instead of a global install", () => {
    expect(markdown).toContain("npx -y linear-axi");
  });

  it("mentions the LINEAR_API_KEY requirement", () => {
    expect(markdown).toContain("LINEAR_API_KEY");
    expect(markdown).toContain("auth status");
  });

  it("embeds the commands block from the top-level help", () => {
    expect(markdown).toContain(extractCommandsBlock());
  });

  it("does not contain a slash-command argument placeholder", () => {
    expect(markdown).not.toContain("$ARGUMENTS");
  });
});

describe("createSkillOpenAiYaml", () => {
  const yaml = createSkillOpenAiYaml();

  it("provides the recommended Codex interface fields", () => {
    expect(yaml).toContain('display_name: "Linear AXI"');
    expect(yaml).toContain("short_description:");
    expect(yaml).toContain('default_prompt: "Use $linear-axi');
  });
});

describe("extractCommandsBlock", () => {
  it("returns the commands[N] block from TOP_HELP", () => {
    const block = extractCommandsBlock();
    expect(block).toMatch(/^commands\[\d+\]:\n/);
    expect(block).toContain("issue");
    expect(block).toContain("setup");
  });
});

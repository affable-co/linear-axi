import { describe, it, expect } from "vitest";
import { getSuggestions, shellArg } from "../src/suggestions.js";
import type { LinearContext } from "../src/context.js";

function ctxWith(source: "flag" | "env" | "config" | "branch", team = "ENG"): LinearContext {
  return { team: { team, source } };
}

describe("getSuggestions", () => {
  it("returns home suggestions listing the command families", () => {
    const lines = getSuggestions({ domain: "home", action: "home" });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.includes("issue") && l.includes("project"))).toBe(true);
  });

  it("returns issue list suggestions when non-empty", () => {
    const lines = getSuggestions({ domain: "issue", action: "list", isEmpty: false });
    expect(lines.some((l) => l.includes("issue view"))).toBe(true);
    expect(lines.some((l) => l.includes("issue create"))).toBe(true);
  });

  it("returns issue list suggestions when empty", () => {
    const lines = getSuggestions({ domain: "issue", action: "list", isEmpty: true });
    expect(lines.some((l) => l.includes("issue create"))).toBe(true);
    expect(lines.some((l) => l.includes("--state completed"))).toBe(true);
  });

  it("returns open-issue view suggestions for open-type states", () => {
    const lines = getSuggestions({ domain: "issue", action: "view", state: "started", id: "ABC-1" });
    expect(lines.some((l) => l.includes("issue close ABC-1"))).toBe(true);
    expect(lines.some((l) => l.includes("issue start ABC-1"))).toBe(true);
    expect(lines.some((l) => l.includes("reopen"))).toBe(false);
  });

  it("returns reopen suggestions for a completed issue view", () => {
    const lines = getSuggestions({ domain: "issue", action: "view", state: "completed", id: "ABC-1" });
    expect(lines.some((l) => l.includes("issue reopen ABC-1"))).toBe(true);
    expect(lines.some((l) => l.includes("issue close"))).toBe(false);
  });

  it("carries the actual --team flag for flag-sourced context", () => {
    const lines = getSuggestions({ domain: "issue", action: "list", isEmpty: true, ctx: ctxWith("flag") });
    // The second empty-state line uses teamFlag() directly.
    expect(lines.some((l) => l.includes("--team ENG"))).toBe(true);
  });

  it("carries the actual --team flag for env-sourced context", () => {
    const lines = getSuggestions({ domain: "issue", action: "list", isEmpty: true, ctx: ctxWith("env") });
    expect(lines.some((l) => l.includes("--team ENG"))).toBe(true);
  });

  it("omits the --team flag for config-sourced context", () => {
    const lines = getSuggestions({ domain: "issue", action: "list", isEmpty: true, ctx: ctxWith("config") });
    const listLine = lines.find((l) => l.includes("issue list"));
    expect(listLine).toBeDefined();
    expect(listLine).not.toContain("--team ENG");
  });

  it("omits the --team flag for branch-sourced context", () => {
    const lines = getSuggestions({ domain: "issue", action: "list", isEmpty: true, ctx: ctxWith("branch") });
    const listLine = lines.find((l) => l.includes("issue list"));
    expect(listLine).not.toContain("--team ENG");
  });

  it("returns comment thread suggestion after commenting", () => {
    const lines = getSuggestions({ domain: "issue", action: "comment", id: "ABC-1" });
    expect(lines.some((l) => l.includes("issue comments ABC-1"))).toBe(true);
  });

  it("returns an empty array for an unmatched domain", () => {
    expect(getSuggestions({ domain: "nonexistent", action: "list" })).toEqual([]);
  });

  it("shell-quotes remote names embedded in runnable commands", () => {
    const lines = getSuggestions({
      domain: "project",
      action: "view",
      id: "$(touch /tmp/pwned)'s project",
    });
    expect(lines[0]).toContain(shellArg("$(touch /tmp/pwned)'s project"));
    expect(lines[0]).not.toContain('--project "$(touch');
  });
});

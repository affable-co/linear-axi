import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("axi-sdk-js", async (importActual) => {
  const actual = await importActual<typeof import("axi-sdk-js")>();
  return { ...actual, installSessionStartHooks: vi.fn() };
});

import { installSessionStartHooks } from "axi-sdk-js";
import { setupCommand, SETUP_HELP } from "../../src/commands/setup.js";

const mockedInstall = vi.mocked(installSessionStartHooks);

describe("setupCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help for --help and no args", async () => {
    expect(await setupCommand(["--help"])).toBe(SETUP_HELP);
    expect(await setupCommand([])).toBe(SETUP_HELP);
  });

  it("HELP ends with an examples section of linear-axi lines", () => {
    const idx = SETUP_HELP.indexOf("examples:");
    expect(idx).toBeGreaterThan(-1);
    const lines = SETUP_HELP.slice(idx).split("\n").slice(1).filter((l) => l.trim());
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(line).toMatch(/^ {2}linear-axi /);
  });

  it("installs hooks with linear-axi marker and entrypoints", async () => {
    const out = await setupCommand(["hooks"]);

    expect(mockedInstall).toHaveBeenCalledTimes(1);
    expect(mockedInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        marker: expect.stringContaining("linear-axi"),
        binaryNames: ["linear-axi"],
        distEntrypoints: ["dist/bin/linear-axi.js"],
      }),
    );
    expect(out).toContain("status: installed");
    expect(out).toContain("Claude Code, Codex, OpenCode");
  });

  it("prints skill install instructions pointing at the bundled SKILL.md", async () => {
    const out = await setupCommand(["skill"]);
    expect(mockedInstall).not.toHaveBeenCalled();
    expect(out).toContain("skills/linear-axi/SKILL.md");
    expect(out).toContain("published: false");
  });

  it("rejects an unknown subcommand", async () => {
    await expect(setupCommand(["bogus"])).rejects.toThrow(/Unknown setup subcommand/);
  });
});

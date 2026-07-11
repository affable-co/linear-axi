import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

vi.mock("../../src/resolve.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/resolve.js")>();
  return { ...actual, resolveTeam: vi.fn(), teamStates: vi.fn() };
});

import { resolveTeam, teamStates } from "../../src/resolve.js";
import { stateCommand, STATE_HELP } from "../../src/commands/state.js";
import { AxiError } from "../../src/errors.js";
import type { LinearContext } from "../../src/context.js";

const mockedResolveTeam = vi.mocked(resolveTeam);
const mockedTeamStates = vi.mocked(teamStates);

const flagCtx: LinearContext = { team: { team: "ENG", source: "flag" } };

describe("stateCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedResolveTeam.mockResolvedValue({ id: "team-uuid", key: "ENG", name: "Engineering" });
  });

  describe("router", () => {
    it("returns help for --help and no subcommand", async () => {
      expect(await stateCommand(["--help"])).toBe(STATE_HELP);
      expect(await stateCommand([])).toBe(STATE_HELP);
    });

    it("errors on unknown subcommand", async () => {
      const out = await stateCommand(["bogus"], flagCtx);
      expect(out).toContain("Unknown state subcommand: bogus");
    });
  });

  describe("list", () => {
    it("requires a team from context", async () => {
      await expect(stateCommand(["list"], undefined)).rejects.toThrow(/needs a team/);
      try {
        await stateCommand(["list"], {});
        expect.unreachable();
      } catch (e) {
        expect((e as AxiError).suggestions.join(" ")).toContain("team list");
      }
    });

    it("lists states in board order with a scope and count line", async () => {
      mockedTeamStates.mockResolvedValue([
        { id: "s3", name: "Done", type: "completed", position: 3 },
        { id: "s1", name: "Todo", type: "unstarted", position: 1 },
        { id: "s2", name: "In Progress", type: "started", position: 2 },
      ]);

      const out = await stateCommand(["list"], flagCtx);
      expect(out).toContain("count: 3");
      expect(out).toContain("scope: team ENG");
      expect(out.indexOf("Todo")).toBeLessThan(out.indexOf("In Progress"));
      expect(out.indexOf("In Progress")).toBeLessThan(out.indexOf("Done"));
    });

    it("shows explicit empty state", async () => {
      mockedTeamStates.mockResolvedValue([]);
      const out = await stateCommand(["list"], flagCtx);
      expect(out).toContain("states: 0 found for team ENG");
    });

    it("rejects unknown flags", async () => {
      await expect(stateCommand(["list", "--bogus"], flagCtx)).rejects.toThrow(AxiError);
    });
  });
});

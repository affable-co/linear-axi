import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

vi.mock("../../src/resolve.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/resolve.js")>();
  return { ...actual, resolveTeam: vi.fn() };
});

import { gqlQuery } from "../../src/linear.js";
import { resolveTeam } from "../../src/resolve.js";
import { teamCommand, TEAM_HELP } from "../../src/commands/team.js";
import { AxiError } from "../../src/errors.js";
import type { LinearContext } from "../../src/context.js";

const mockedGql = vi.mocked(gqlQuery);
const mockedResolveTeam = vi.mocked(resolveTeam);

const flagCtx: LinearContext = { team: { team: "ENG", source: "flag" } };

describe("teamCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help for --help and no subcommand", async () => {
      expect(await teamCommand(["--help"])).toBe(TEAM_HELP);
      expect(await teamCommand([])).toBe(TEAM_HELP);
    });

    it("errors on unknown subcommand", async () => {
      const out = await teamCommand(["bogus"]);
      expect(out).toContain("Unknown team subcommand: bogus");
    });
  });

  describe("list", () => {
    it("lists teams with count line", async () => {
      mockedGql.mockResolvedValue({
        teams: {
          nodes: [
            { key: "ENG", name: "Engineering" },
            { key: "DES", name: "Design" },
          ],
          pageInfo: { hasNextPage: false },
        },
      });

      const out = await teamCommand(["list"]);
      expect(out).toContain("ENG");
      expect(out).toContain("Engineering");
      expect(out).toContain("DES");
      expect(out).toContain("count: 2");
      expect(mockedGql).toHaveBeenCalledWith(expect.any(String), { first: 50 });
    });

    it("adds extra field selections via --fields", async () => {
      mockedGql.mockResolvedValue({
        teams: { nodes: [{ key: "ENG", name: "Engineering", cyclesEnabled: true }], pageInfo: { hasNextPage: false } },
      });

      const out = await teamCommand(["list", "--fields", "cycles"]);
      const query = mockedGql.mock.calls[0][0] as string;
      expect(query).toContain("cyclesEnabled");
      expect(out).toContain("{key,name,cycles}");
      expect(out).toContain("ENG,Engineering,yes");
    });

    it("respects --limit", async () => {
      mockedGql.mockResolvedValue({ teams: { nodes: [], pageInfo: { hasNextPage: false } } });
      await teamCommand(["list", "--limit", "5"]);
      expect(mockedGql).toHaveBeenCalledWith(expect.any(String), { first: 5 });
    });

    it("shows explicit empty state", async () => {
      mockedGql.mockResolvedValue({ teams: { nodes: [], pageInfo: { hasNextPage: false } } });
      const out = await teamCommand(["list"]);
      expect(out).toContain("teams: 0 found");
    });

    it("rejects unknown flags and lists valid ones", async () => {
      await expect(teamCommand(["list", "--bogus"])).rejects.toThrow(AxiError);
      try {
        await teamCommand(["list", "--bogus"]);
        expect.unreachable();
      } catch (e) {
        const err = e as AxiError;
        expect(err.message).toContain("--bogus");
        expect(err.suggestions.join(" ")).toContain("--limit");
      }
    });
  });

  describe("view", () => {
    beforeEach(() => {
      mockedResolveTeam.mockResolvedValue({ id: "team-uuid", key: "ENG", name: "Engineering" });
    });

    it("renders detail, states in board order, and inline labels in one call", async () => {
      mockedGql.mockResolvedValue({
        team: {
          key: "ENG",
          name: "Engineering",
          description: "The eng team",
          cyclesEnabled: true,
          activeCycle: { number: 7, name: "Sprint 7" },
          members: { nodes: [{ displayName: "Alice" }, { displayName: "Bob" }] },
        },
        workflowStates: {
          nodes: [
            { name: "Done", type: "completed", position: 3 },
            { name: "Todo", type: "unstarted", position: 1 },
            { name: "In Progress", type: "started", position: 2 },
          ],
        },
        issueLabels: { nodes: [{ name: "bug" }, { name: "feature" }] },
      });

      const out = await teamCommand(["view", "ENG"], flagCtx);
      expect(out).toContain("key: ENG");
      expect(out).toContain("cycles_enabled: yes");
      expect(out).toContain("active_cycle: 7 (Sprint 7)");
      expect(out).toContain("members: 2");
      // states sorted by position: Todo before In Progress before Done
      const todoIdx = out.indexOf("Todo");
      const progIdx = out.indexOf("In Progress");
      const doneIdx = out.indexOf("Done");
      expect(todoIdx).toBeLessThan(progIdx);
      expect(progIdx).toBeLessThan(doneIdx);
      expect(out).toContain("labels[2]: bug, feature");
      // one aggregate round trip after resolveTeam
      expect(mockedGql).toHaveBeenCalledTimes(1);
      expect(mockedGql).toHaveBeenCalledWith(expect.any(String), { id: "team-uuid", teamId: "team-uuid" });
    });

    it("handles teams with no cycle, labels, or states", async () => {
      mockedGql.mockResolvedValue({
        team: {
          key: "ENG",
          name: "Engineering",
          description: null,
          cyclesEnabled: false,
          activeCycle: null,
          members: { nodes: [] },
        },
        workflowStates: { nodes: [] },
        issueLabels: { nodes: [] },
      });

      const out = await teamCommand(["view", "ENG"], flagCtx);
      expect(out).toContain("active_cycle: none");
      expect(out).toContain("states: 0");
      expect(out).toContain("labels: 0");
    });

    it("requires a team argument", async () => {
      await expect(teamCommand(["view"], flagCtx)).rejects.toThrow(AxiError);
    });
  });
});

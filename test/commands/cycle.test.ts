import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

vi.mock("../../src/resolve.js", () => ({
  resolveTeam: vi.fn(),
  resolveCycle: vi.fn(),
}));

import { gqlQuery } from "../../src/linear.js";
import { resolveTeam, resolveCycle } from "../../src/resolve.js";
import { cycleCommand, CYCLE_HELP } from "../../src/commands/cycle.js";
import { AxiError } from "../../src/errors.js";
import type { LinearContext } from "../../src/context.js";

const mockedGql = vi.mocked(gqlQuery);
const mockedResolveTeam = vi.mocked(resolveTeam);
const mockedResolveCycle = vi.mocked(resolveCycle);

const ctx: LinearContext = { team: { team: "ENG", source: "flag" } };

describe("cycleCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedResolveTeam.mockResolvedValue({ id: "team-1", key: "ENG", name: "Engineering" });
    mockedResolveCycle.mockResolvedValue({ id: "cycle-1", name: "Sprint 3", number: 3 });
  });

  describe("router", () => {
    it("returns help for --help", async () => {
      expect(await cycleCommand(["--help"])).toBe(CYCLE_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      expect(await cycleCommand([])).toBe(CYCLE_HELP);
    });

    it("errors on an unknown subcommand", async () => {
      expect(await cycleCommand(["delete"])).toContain("Unknown cycle subcommand: delete");
    });

    it("HELP ends with an examples section of linear-axi lines", () => {
      const lines = CYCLE_HELP.trimEnd().split("\n");
      const idx = lines.findIndex((l) => l.startsWith("examples:"));
      expect(idx).toBeGreaterThanOrEqual(0);
      const examples = lines.slice(idx + 1);
      expect(examples.length).toBeGreaterThanOrEqual(2);
      expect(examples.every((l) => l.startsWith("  linear-axi "))).toBe(true);
    });
  });

  describe("list", () => {
    it("requires a team", async () => {
      await expect(cycleCommand(["list"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("cycle list needs a team"),
      });
    });

    it("filters by team and renders the schema with sliced dates and progress", async () => {
      mockedGql.mockResolvedValue({
        cycles: {
          nodes: [
            {
              number: 3,
              name: "Sprint 3",
              startsAt: "2026-07-01T00:00:00.000Z",
              endsAt: "2026-07-14T00:00:00.000Z",
              progress: 0.25,
              isActive: true,
            },
          ],
          pageInfo: { hasNextPage: false },
        },
      });

      const out = await cycleCommand(["list"], ctx);

      const [, vars] = mockedGql.mock.calls[0];
      expect((vars as { filter: { team: { id: { eq: string } } } }).filter.team).toEqual({ id: { eq: "team-1" } });
      expect(out).toContain("count: 1");
      expect(out).toContain("scope: team ENG");
      expect(out).toContain("Sprint 3");
      expect(out).toContain("2026-07-01");
      expect(out).toContain("2026-07-14");
      expect(out).toContain("25%");
      expect(out).toContain("yes");
    });

    it("drops the date filter when --all is passed", async () => {
      mockedGql.mockResolvedValue({ cycles: { nodes: [], pageInfo: { hasNextPage: false } } });

      await cycleCommand(["list", "--all"], ctx);

      const [, vars] = mockedGql.mock.calls[0];
      expect((vars as { filter: Record<string, unknown> }).filter).not.toHaveProperty("endsAt");
    });

    it("applies a default date filter without --all", async () => {
      mockedGql.mockResolvedValue({ cycles: { nodes: [], pageInfo: { hasNextPage: false } } });

      await cycleCommand(["list"], ctx);

      const [, vars] = mockedGql.mock.calls[0];
      expect((vars as { filter: Record<string, unknown> }).filter).toHaveProperty("endsAt");
    });

    it("reports an explicit empty state naming the team", async () => {
      mockedGql.mockResolvedValue({ cycles: { nodes: [], pageInfo: { hasNextPage: false } } });

      const out = await cycleCommand(["list"], ctx);
      expect(out).toContain("cycles: 0 found for team ENG");
    });

    it("rejects an unknown flag", async () => {
      await expect(cycleCommand(["list", "--bogus"], ctx)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });
  });

  describe("view", () => {
    it("resolves the cycle and renders aggregates from the count histories", async () => {
      mockedGql.mockResolvedValue({
        cycle: {
          id: "cycle-1",
          number: 3,
          name: "Sprint 3",
          startsAt: "2026-07-01T00:00:00.000Z",
          endsAt: "2026-07-14T00:00:00.000Z",
          progress: 0.5,
          issueCountHistory: [4, 8, 12],
          completedIssueCountHistory: [1, 3, 6],
        },
      });

      const out = await cycleCommand(["view", "current"], ctx);

      expect(mockedResolveCycle).toHaveBeenCalledWith("current", expect.objectContaining({ id: "team-1" }));
      const [, vars] = mockedGql.mock.calls[0];
      expect(vars).toEqual({ id: "cycle-1" });
      expect(out).toContain("Sprint 3");
      expect(out).toContain("50%");
      expect(out).toContain("12");
      expect(out).toContain("6");
    });

    it("omits aggregates when the count histories are empty", async () => {
      mockedGql.mockResolvedValue({
        cycle: {
          id: "cycle-1",
          number: 3,
          name: "Sprint 3",
          startsAt: "2026-07-01T00:00:00.000Z",
          endsAt: "2026-07-14T00:00:00.000Z",
          progress: 0.5,
          issueCountHistory: [],
          completedIssueCountHistory: [],
        },
      });

      const out = await cycleCommand(["view", "3"], ctx);
      expect(out).not.toContain("issues:");
      expect(out).not.toContain("completed:");
    });

    it("requires a team", async () => {
      await expect(cycleCommand(["view", "current"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        message: expect.stringContaining("cycle view needs a team"),
      });
    });

    it("throws when the cycle reference is missing", async () => {
      await expect(cycleCommand(["view"], ctx)).rejects.toThrow(AxiError);
    });
  });
});

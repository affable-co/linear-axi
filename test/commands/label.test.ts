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
import { labelCommand, LABEL_HELP } from "../../src/commands/label.js";
import { AxiError } from "../../src/errors.js";
import type { LinearContext } from "../../src/context.js";

const mockedGql = vi.mocked(gqlQuery);
const mockedResolveTeam = vi.mocked(resolveTeam);

const flagCtx: LinearContext = { team: { team: "ENG", source: "flag" } };

describe("labelCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedResolveTeam.mockResolvedValue({ id: "team-uuid", key: "ENG", name: "Engineering" });
  });

  describe("router", () => {
    it("returns help for --help and no subcommand", async () => {
      expect(await labelCommand(["--help"])).toBe(LABEL_HELP);
      expect(await labelCommand([])).toBe(LABEL_HELP);
    });

    it("errors on unknown subcommand", async () => {
      const out = await labelCommand(["bogus"]);
      expect(out).toContain("Unknown label subcommand: bogus");
    });
  });

  describe("list", () => {
    it("lists all labels with scope/group when no team in context", async () => {
      mockedGql.mockResolvedValue({
        issueLabels: {
          nodes: [
            { name: "bug", team: { key: "ENG" }, parent: null },
            { name: "urgent", team: null, parent: { name: "priority" } },
          ],
          pageInfo: { hasNextPage: false },
        },
      });

      const out = await labelCommand(["list"]);
      expect(out).toContain("bug");
      expect(out).toContain("urgent");
      expect(out).toContain("workspace"); // team null → workspace scope
      expect(out).toContain("priority"); // parent group
      expect(out).toContain("count: 2");
      expect(mockedGql).toHaveBeenCalledWith(expect.any(String), { filter: null, first: 100 });
    });

    it("scopes to team + workspace labels when a team is in context", async () => {
      mockedGql.mockResolvedValue({
        issueLabels: { nodes: [{ name: "bug", team: { key: "ENG" }, parent: null }], pageInfo: { hasNextPage: false } },
      });

      const out = await labelCommand(["list"], flagCtx);
      const filter = mockedGql.mock.calls[0][1] as { filter: { or: unknown[] } };
      expect(filter.filter.or).toHaveLength(2);
      expect(filter.filter.or).toContainEqual({ team: { null: true } });
      expect(filter.filter.or).toContainEqual({ team: { id: { eq: "team-uuid" } } });
      expect(out).toContain("team: ENG + workspace");
    });

    it("combines team scope and --query with and", async () => {
      mockedGql.mockResolvedValue({ issueLabels: { nodes: [], pageInfo: { hasNextPage: false } } });
      await labelCommand(["list", "--query", "bug"], flagCtx);
      const filter = mockedGql.mock.calls[0][1] as { filter: { and: unknown[] } };
      expect(filter.filter.and).toHaveLength(2);
      expect(filter.filter.and).toContainEqual({ name: { containsIgnoreCase: "bug" } });
    });

    it("shows explicit empty state", async () => {
      mockedGql.mockResolvedValue({ issueLabels: { nodes: [], pageInfo: { hasNextPage: false } } });
      const out = await labelCommand(["list", "--query", "nope"]);
      expect(out).toContain("labels: 0 found matching query: nope");
    });

    it("rejects unknown flags", async () => {
      await expect(labelCommand(["list", "--bogus"])).rejects.toThrow(AxiError);
    });
  });

  describe("create", () => {
    it("creates a team-scoped label", async () => {
      mockedGql.mockResolvedValue({
        issueLabelCreate: { success: true, issueLabel: { id: "lbl-1", name: "priority:high" } },
      });

      const out = await labelCommand(
        ["create", "--name", "priority:high", "--color", "#ff0000", "--description", "urgent stuff"],
        flagCtx,
      );
      const input = (mockedGql.mock.calls[0][1] as { input: Record<string, unknown> }).input;
      expect(input).toEqual({
        name: "priority:high",
        teamId: "team-uuid",
        color: "#ff0000",
        description: "urgent stuff",
      });
      expect(out).toContain("priority:high");
      expect(out).toContain("scope: ENG");
    });

    it("creates a workspace label when no team in context", async () => {
      mockedGql.mockResolvedValue({
        issueLabelCreate: { success: true, issueLabel: { id: "lbl-2", name: "global" } },
      });

      const out = await labelCommand(["create", "--name", "global"]);
      const input = (mockedGql.mock.calls[0][1] as { input: Record<string, unknown> }).input;
      expect(input).toEqual({ name: "global" });
      expect(out).toContain("scope: workspace");
    });

    it("throws when --name is missing", async () => {
      await expect(labelCommand(["create", "--color", "#fff"])).rejects.toThrow(AxiError);
    });

    it("rejects unknown flags", async () => {
      await expect(labelCommand(["create", "--name", "x", "--bogus"])).rejects.toThrow(AxiError);
    });
  });
});

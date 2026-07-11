import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

vi.mock("../../src/resolve.js", () => ({
  resolveTeam: vi.fn(),
  resolveProject: vi.fn(),
  resolveUser: vi.fn(),
  resolveProjectStatus: vi.fn(),
}));

import { gqlQuery } from "../../src/linear.js";
import { resolveTeam, resolveProject, resolveUser, resolveProjectStatus } from "../../src/resolve.js";
import { projectCommand, PROJECT_HELP } from "../../src/commands/project.js";
import { AxiError } from "../../src/errors.js";
import type { LinearContext } from "../../src/context.js";

const mockedGql = vi.mocked(gqlQuery);
const mockedResolveTeam = vi.mocked(resolveTeam);
const mockedResolveProject = vi.mocked(resolveProject);
const mockedResolveUser = vi.mocked(resolveUser);
const mockedResolveProjectStatus = vi.mocked(resolveProjectStatus);

const ctx: LinearContext = { team: { team: "ENG", source: "flag" } };

describe("projectCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedResolveTeam.mockResolvedValue({ id: "team-1", key: "ENG", name: "Engineering" });
    mockedResolveProject.mockResolvedValue({ id: "proj-1", name: "Q3 Launch" });
    mockedResolveUser.mockResolvedValue({ id: "user-1", displayName: "Ada" });
    mockedResolveProjectStatus.mockResolvedValue({ id: "status-1", name: "Planned", type: "planned" });
  });

  describe("router", () => {
    it("returns help for --help", async () => {
      expect(await projectCommand(["--help"])).toBe(PROJECT_HELP);
    });

    it("returns help when no subcommand is given", async () => {
      expect(await projectCommand([])).toBe(PROJECT_HELP);
    });

    it("errors on an unknown subcommand", async () => {
      const out = await projectCommand(["frobnicate"]);
      expect(out).toContain("Unknown project subcommand: frobnicate");
    });

    it("HELP ends with an examples section of linear-axi lines", () => {
      const lines = PROJECT_HELP.trimEnd().split("\n");
      const idx = lines.findIndex((l) => l.startsWith("examples:"));
      expect(idx).toBeGreaterThanOrEqual(0);
      const examples = lines.slice(idx + 1);
      expect(examples.length).toBeGreaterThanOrEqual(2);
      expect(examples.every((l) => l.startsWith("  linear-axi "))).toBe(true);
    });
  });

  describe("list", () => {
    it("renders the default schema with a count line and progress percent", async () => {
      mockedGql.mockResolvedValue({
        projects: {
          nodes: [{ name: "Q3 Launch", state: "started", progress: 0.42, targetDate: "2026-09-30" }],
          pageInfo: { hasNextPage: false },
        },
      });

      const out = await projectCommand(["list"], ctx);

      expect(out).toContain("count: 1");
      expect(out).toContain("Q3 Launch");
      expect(out).toContain("started");
      expect(out).toContain("42%");
      expect(out).toContain("2026-09-30");
    });

    it("passes a state + query filter to gqlQuery", async () => {
      mockedGql.mockResolvedValue({ projects: { nodes: [], pageInfo: { hasNextPage: false } } });

      await projectCommand(["list", "--state", "completed", "--query", "launch"], ctx);

      const [, vars] = mockedGql.mock.calls[0];
      expect(vars).toMatchObject({
        filter: { state: { eq: "completed" }, name: { containsIgnoreCase: "launch" } },
        first: 25,
      });
    });

    it("reports an explicit empty state echoing the filters", async () => {
      mockedGql.mockResolvedValue({ projects: { nodes: [], pageInfo: { hasNextPage: false } } });

      const out = await projectCommand(["list", "--state", "completed"], ctx);

      expect(out).toContain("projects: 0 found matching state: completed");
    });

    it("adds requested extra fields to the selection", async () => {
      mockedGql.mockResolvedValue({ projects: { nodes: [], pageInfo: { hasNextPage: false } } });

      await projectCommand(["list", "--fields", "lead,teams"], ctx);

      const [query] = mockedGql.mock.calls[0];
      expect(query).toContain("lead { displayName }");
      expect(query).toContain("teams { nodes { key } }");
    });

    it("rejects an invalid --state value", async () => {
      await expect(projectCommand(["list", "--state", "bogus"], ctx)).rejects.toThrow(AxiError);
    });

    it("rejects an unknown flag and names the valid flags", async () => {
      await expect(projectCommand(["list", "--owner", "x"], ctx)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("surfaces a more-available hint when the page is truncated", async () => {
      mockedGql.mockResolvedValue({
        projects: { nodes: [{ name: "P", state: "started", progress: 0, targetDate: null }], pageInfo: { hasNextPage: true } },
      });

      const out = await projectCommand(["list"], ctx);
      expect(out).toContain("more available");
    });
  });

  describe("view", () => {
    it("renders detail with progress percent and truncates a long description", async () => {
      mockedGql.mockResolvedValue({
        project: {
          name: "Q3 Launch",
          state: "started",
          progress: 0.5,
          lead: { displayName: "Ada" },
          teams: { nodes: [{ key: "ENG" }] },
          startDate: "2026-07-01",
          targetDate: "2026-09-30",
          url: "https://linear.app/acme/project/q3",
          description: "x".repeat(1500),
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      });

      const out = await projectCommand(["view", "Q3 Launch"], ctx);

      expect(mockedResolveProject).toHaveBeenCalledWith("Q3 Launch");
      expect(out).toContain("50%");
      expect(out).toContain("Ada");
      expect(out).toContain("ENG");
      expect(out).toContain("truncated");
    });

    it("keeps the full description with --full", async () => {
      mockedGql.mockResolvedValue({
        project: {
          name: "Q3 Launch",
          state: "started",
          progress: 0.5,
          lead: null,
          teams: { nodes: [] },
          startDate: null,
          targetDate: null,
          url: "u",
          description: "y".repeat(1500),
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      });

      const out = await projectCommand(["view", "Q3 Launch", "--full"], ctx);
      expect(out).not.toContain("truncated");
    });

    it("throws when the positional name is missing", async () => {
      await expect(projectCommand(["view"], ctx)).rejects.toThrow(AxiError);
    });
  });

  describe("create", () => {
    it("sends teamIds as an array and resolved references", async () => {
      mockedGql.mockResolvedValue({
        projectCreate: { success: true, project: { id: "p1", name: "Q3 Launch", state: "planned", url: "u" } },
      });

      const out = await projectCommand(
        ["create", "--name", "Q3 Launch", "--lead", "ada", "--state", "planned", "--target", "2026-09-30"],
        ctx,
      );

      const [query, vars] = mockedGql.mock.calls[0];
      expect(query).toContain("projectCreate(input: $input)");
      expect(mockedResolveProjectStatus).toHaveBeenCalledWith("planned");
      expect((vars as { input: Record<string, unknown> }).input).toMatchObject({
        name: "Q3 Launch",
        teamIds: ["team-1"],
        leadId: "user-1",
        statusId: "status-1",
        targetDate: "2026-09-30",
      });
      expect(out).toContain("Q3 Launch");
    });

    it("errors when no team is in context", async () => {
      await expect(projectCommand(["create", "--name", "X"])).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
      });
    });

    it("errors when --name is missing", async () => {
      await expect(projectCommand(["create"], ctx)).rejects.toThrow(AxiError);
    });

    it("rejects an invalid --target date", async () => {
      await expect(
        projectCommand(["create", "--name", "X", "--target", "09/30/2026"], ctx),
      ).rejects.toThrow(AxiError);
    });
  });

  describe("update", () => {
    it("resolves the project and sends the changed fields", async () => {
      mockedGql.mockResolvedValue({
        projectUpdate: { success: true, project: { name: "Q3 Launch", state: "completed", url: "u" } },
      });

      await projectCommand(["update", "Q3 Launch", "--state", "completed"], ctx);

      expect(mockedResolveProject).toHaveBeenCalledWith("Q3 Launch");
      const [query, vars] = mockedGql.mock.calls[0];
      expect(query).toContain("projectUpdate(id: $id, input: $input)");
      expect(vars).toMatchObject({ id: "proj-1", input: { statusId: "status-1" } });
    });

    it("errors when no field flags are passed", async () => {
      await expect(projectCommand(["update", "Q3 Launch"], ctx)).rejects.toMatchObject({
        message: expect.stringContaining("Nothing to update"),
      });
    });
  });
});

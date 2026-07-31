import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/linear.js", () => ({
  gqlQuery: vi.fn(),
}));

import { gqlQuery } from "../src/linear.js";
import {
  resolveTeam,
  resolveState,
  resolveUser,
  resolveLabel,
  resolveProject,
  resolveCycle,
  normalizeIssueRef,
  clearResolverCaches,
  isUuid,
  type ResolvedTeam,
} from "../src/resolve.js";
import { AxiError } from "../src/errors.js";

const mockedGql = vi.mocked(gqlQuery);
const TEAM: ResolvedTeam = { id: "team-uuid", key: "ENG", name: "Engineering" };
const UUID = "12345678-1234-1234-1234-1234567890ab";

beforeEach(() => {
  vi.resetAllMocks();
  clearResolverCaches();
});

describe("isUuid", () => {
  it("recognizes a UUID and rejects an identifier", () => {
    expect(isUuid(UUID)).toBe(true);
    expect(isUuid("ENG-123")).toBe(false);
  });
});

describe("resolveTeam", () => {
  const teams = { teams: { nodes: [{ id: "t1", key: "ENG", name: "Engineering" }, { id: "t2", key: "OPS", name: "Operations" }] } };

  it("matches by key case-insensitively", async () => {
    mockedGql.mockResolvedValue(teams);
    const team = await resolveTeam("eng");
    expect(team.id).toBe("t1");
  });

  it("matches by name case-insensitively", async () => {
    mockedGql.mockResolvedValue(teams);
    const team = await resolveTeam("operations");
    expect(team.key).toBe("OPS");
  });

  it("throws NOT_FOUND listing available keys for an unknown team", async () => {
    mockedGql.mockResolvedValue(teams);
    try {
      await resolveTeam("ZZZ");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("NOT_FOUND");
      expect((e as AxiError).message).toContain("ENG");
      expect((e as AxiError).message).toContain("OPS");
    }
  });

  it("passes a UUID through a direct team query", async () => {
    mockedGql.mockResolvedValue({ team: { id: UUID, key: "ENG", name: "Engineering" } });
    const team = await resolveTeam(UUID);
    expect(team.id).toBe(UUID);
    const query = mockedGql.mock.calls[0][0] as string;
    expect(query).toContain("team(id: $id)");
  });

  it("caches by input so a repeat resolve makes no second query", async () => {
    mockedGql.mockResolvedValue(teams);
    await resolveTeam("eng");
    await resolveTeam("eng");
    expect(mockedGql).toHaveBeenCalledTimes(1);
  });
});

describe("resolveState", () => {
  const states = {
    workflowStates: {
      nodes: [
        { id: "s-todo", name: "Todo", type: "unstarted", position: 0 },
        { id: "s-review", name: "In Review", type: "started", position: 1 },
        { id: "s-done-a", name: "Done", type: "completed", position: 2 },
        { id: "s-done-b", name: "Shipped", type: "completed", position: 1 },
      ],
    },
  };

  it("matches a state by name case-insensitively", async () => {
    mockedGql.mockResolvedValue(states);
    const state = await resolveState(TEAM, "in review");
    expect(state.id).toBe("s-review");
    expect(state.type).toBe("started");
  });

  it("resolves a state type to the lowest-position state of that type", async () => {
    mockedGql.mockResolvedValue(states);
    const state = await resolveState(TEAM, "completed");
    // Both "Done" (pos 2) and "Shipped" (pos 1) are completed; lowest wins.
    expect(state.id).toBe("s-done-b");
  });

  it("passes a UUID straight through without a query", async () => {
    const state = await resolveState(TEAM, UUID);
    expect(state.id).toBe(UUID);
    expect(mockedGql).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND listing state names AND types for an unknown state", async () => {
    mockedGql.mockResolvedValue(states);
    try {
      await resolveState(TEAM, "Nonexistent");
      expect.fail("should have thrown");
    } catch (e) {
      const msg = (e as AxiError).message;
      expect((e as AxiError).code).toBe("NOT_FOUND");
      expect(msg).toContain("Todo");
      expect(msg).toContain("In Review");
      expect(msg).toContain("triage");
      expect(msg).toContain("completed");
    }
  });
});

describe("resolveUser", () => {
  const users = {
    users: {
      nodes: [
        { id: "u1", displayName: "Alice Adams", name: "aliceadams", email: "alice@acme.co" },
        { id: "u2", displayName: "Alice Baker", name: "alicebaker", email: "ab@acme.co" },
        { id: "u3", displayName: "Bob", name: "bob", email: "bob@acme.co" },
      ],
    },
  };

  it("resolves 'me' to the viewer", async () => {
    mockedGql.mockResolvedValue({ viewer: { id: "me-id", displayName: "Me" } });
    const user = await resolveUser("me");
    expect(user.id).toBe("me-id");
    expect(mockedGql.mock.calls[0][0]).toContain("viewer");
  });

  it("passes a UUID straight through", async () => {
    const user = await resolveUser(UUID);
    expect(user.id).toBe(UUID);
    expect(mockedGql).not.toHaveBeenCalled();
  });

  it("matches an exact email", async () => {
    mockedGql.mockResolvedValue(users);
    expect((await resolveUser("bob@acme.co")).id).toBe("u3");
  });

  it("matches an exact display name", async () => {
    mockedGql.mockResolvedValue(users);
    expect((await resolveUser("Bob")).id).toBe("u3");
  });

  it("accepts a single partial match", async () => {
    mockedGql.mockResolvedValue(users);
    expect((await resolveUser("bak")).id).toBe("u2");
  });

  it("rejects an ambiguous partial match with VALIDATION_ERROR", async () => {
    mockedGql.mockResolvedValue(users);
    try {
      await resolveUser("alice");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("VALIDATION_ERROR");
      expect((e as AxiError).message).toContain("Ambiguous");
    }
  });

  it("throws NOT_FOUND when nothing matches", async () => {
    mockedGql.mockResolvedValue(users);
    try {
      await resolveUser("zzz");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("NOT_FOUND");
    }
  });
});

describe("resolveLabel", () => {
  it("prefers the team-scoped label over a workspace label", async () => {
    mockedGql.mockResolvedValue({
      issueLabels: {
        nodes: [
          { id: "ws", name: "bug", team: null },
          { id: "scoped", name: "bug", team: { id: TEAM.id } },
        ],
      },
    });
    const label = await resolveLabel("bug", TEAM);
    expect(label.id).toBe("scoped");
  });

  it("falls back to a workspace label when no team-scoped one matches", async () => {
    mockedGql.mockResolvedValue({
      issueLabels: { nodes: [{ id: "ws", name: "bug", team: null }] },
    });
    const label = await resolveLabel("bug", TEAM);
    expect(label.id).toBe("ws");
  });

  it("passes a UUID straight through", async () => {
    const label = await resolveLabel(UUID);
    expect(label.id).toBe(UUID);
    expect(mockedGql).not.toHaveBeenCalled();
  });

  it("throws NOT_FOUND with a label-list suggestion when unknown", async () => {
    mockedGql.mockResolvedValue({ issueLabels: { nodes: [] } });
    try {
      await resolveLabel("ghost", TEAM);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("NOT_FOUND");
      expect((e as AxiError).suggestions.join(" ")).toContain("label list");
    }
  });
});

describe("resolveProject", () => {
  it("resolves a project by name", async () => {
    mockedGql.mockResolvedValue({ projects: { nodes: [{ id: "p1", name: "Website" }] } });
    expect((await resolveProject("Website")).id).toBe("p1");
  });

  it("passes a UUID straight through", async () => {
    const project = await resolveProject(UUID);
    expect(project.id).toBe(UUID);
    expect(mockedGql).not.toHaveBeenCalled();
  });

  it("rejects ambiguous project names and lists their ids", async () => {
    mockedGql.mockResolvedValue({
      projects: { nodes: [{ id: "p1", name: "Website" }, { id: "p2", name: "Website" }] },
    });

    await expect(resolveProject("Website")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("p1"),
    });
  });

  it("throws NOT_FOUND with a suggestion when unknown", async () => {
    mockedGql.mockResolvedValue({ projects: { nodes: [] } });
    try {
      await resolveProject("ghost");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("NOT_FOUND");
      expect((e as AxiError).suggestions.join(" ")).toContain("project list");
    }
  });
});

describe("resolveCycle", () => {
  it("resolves 'current' using the isActive filter field", async () => {
    mockedGql.mockResolvedValue({ cycles: { nodes: [{ id: "c1", number: 5, name: "Cycle 5" }] } });
    const cycle = await resolveCycle("current", TEAM);
    expect(cycle.id).toBe("c1");
    expect(mockedGql.mock.calls[0][0]).toContain("isActive");
  });

  it("resolves 'next' using the isNext filter field", async () => {
    mockedGql.mockResolvedValue({ cycles: { nodes: [{ id: "c2", number: 6, name: "Cycle 6" }] } });
    await resolveCycle("next", TEAM);
    expect(mockedGql.mock.calls[0][0]).toContain("isNext");
  });

  it("resolves 'previous' using the isPrevious filter field", async () => {
    mockedGql.mockResolvedValue({ cycles: { nodes: [{ id: "c0", number: 4, name: "Cycle 4" }] } });
    await resolveCycle("previous", TEAM);
    expect(mockedGql.mock.calls[0][0]).toContain("isPrevious");
  });

  it("resolves a cycle by number", async () => {
    mockedGql.mockResolvedValue({ cycles: { nodes: [{ id: "c3", number: 3, name: "Cycle 3" }] } });
    const cycle = await resolveCycle("3", TEAM);
    expect(cycle.number).toBe(3);
    expect(mockedGql.mock.calls[0][1]).toMatchObject({ number: 3 });
  });

  it("resolves a cycle by name", async () => {
    mockedGql.mockResolvedValue({ cycles: { nodes: [{ id: "c4", number: 7, name: "Sprint" }] } });
    const cycle = await resolveCycle("Sprint", TEAM);
    expect(cycle.name).toBe("Sprint");
    expect(mockedGql.mock.calls[0][1]).toMatchObject({ name: "Sprint" });
  });

  it("throws NOT_FOUND when there is no current cycle", async () => {
    mockedGql.mockResolvedValue({ cycles: { nodes: [] } });
    try {
      await resolveCycle("current", TEAM);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("NOT_FOUND");
      expect((e as AxiError).message).toContain("current");
    }
  });
});

describe("normalizeIssueRef", () => {
  it("uppercases an identifier", () => {
    expect(normalizeIssueRef("abc-123")).toBe("ABC-123");
  });

  it("expands a bare number using the context team key", () => {
    expect(normalizeIssueRef("42", { team: { team: "eng", source: "flag" } })).toBe("ENG-42");
  });

  it("expands a bare number using the branch issue team when no team context exists", () => {
    expect(normalizeIssueRef("42", { branchIssue: "OPS-1" })).toBe("OPS-42");
  });

  it("throws VALIDATION_ERROR for a bare number without any team", () => {
    try {
      normalizeIssueRef("42");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("VALIDATION_ERROR");
      expect((e as AxiError).message).toContain("needs a team");
    }
  });

  it("passes a UUID straight through", () => {
    expect(normalizeIssueRef(UUID)).toBe(UUID);
  });

  it("throws VALIDATION_ERROR for garbage input", () => {
    try {
      normalizeIssueRef("not an issue");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("VALIDATION_ERROR");
    }
  });
});

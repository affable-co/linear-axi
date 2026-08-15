import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
}));

vi.mock("../../src/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/resolve.js")>();
  return {
    ...actual,
    // Keep normalizeIssueRef / isUuid real; stub the async resolvers.
    resolveTeam: vi.fn(),
    resolveUser: vi.fn(),
    resolveState: vi.fn(),
    resolveLabel: vi.fn(),
    resolveProject: vi.fn(),
    resolveCycle: vi.fn(),
  };
});

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
}));

import { execFile } from "node:child_process";
import { gqlQuery } from "../../src/linear.js";
import {
  resolveTeam,
  resolveUser,
  resolveState,
  resolveLabel,
  resolveProject,
  resolveCycle,
} from "../../src/resolve.js";
import { issueCommand, ISSUE_HELP } from "../../src/commands/issue.js";
import { AxiError } from "../../src/errors.js";
import type { LinearContext } from "../../src/context.js";

const mockedGql = vi.mocked(gqlQuery);
const mockedResolveTeam = vi.mocked(resolveTeam);
const mockedResolveUser = vi.mocked(resolveUser);
const mockedResolveState = vi.mocked(resolveState);
const mockedResolveLabel = vi.mocked(resolveLabel);
const mockedResolveProject = vi.mocked(resolveProject);
const mockedResolveCycle = vi.mocked(resolveCycle);
const mockedExecFile = vi.mocked(execFile);

const TEAM = { id: "team-uuid", key: "ENG", name: "Engineering" };
const teamCtx: LinearContext = { team: { team: "ENG", source: "flag" } };

interface CoreOverrides {
  identifier?: string;
  stateType?: string;
  stateName?: string;
  assignee?: { id: string; displayName: string } | null;
  branchName?: string;
}

function coreResponse(o: CoreOverrides = {}) {
  return {
    issue: {
      id: "issue-node-id",
      identifier: o.identifier ?? "ENG-1",
      title: "Fix login",
      url: "https://linear.app/acme/issue/ENG-1",
      branchName: o.branchName ?? "eng-1-fix-login",
      state: { id: "st-1", name: o.stateName ?? "Todo", type: o.stateType ?? "unstarted" },
      assignee: o.assignee === undefined ? null : o.assignee,
      team: { id: TEAM.id, key: TEAM.key, name: TEAM.name },
    },
  };
}

const updateResponse = {
  issueUpdate: {
    success: true,
    issue: { identifier: "ENG-1", state: { name: "Done", type: "completed" }, assignee: { displayName: "Me" } },
  },
};

async function withBodyFile<T>(body: string, fn: (file: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "linear-axi-issue-body-"));
  try {
    const file = join(dir, "body.md");
    writeFileSync(file, body, "utf8");
    return await fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  mockedResolveTeam.mockResolvedValue(TEAM);
  // Default git stub: every git call "succeeds".
  mockedExecFile.mockImplementation(((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
    (cb as (e: Error | null, out: string, err: string) => void)(null, "", "");
    return {} as never;
  }) as never);
});

describe("issueCommand router", () => {
  it("returns help for --help", async () => {
    expect(await issueCommand(["--help"], teamCtx)).toContain(ISSUE_HELP);
  });
  it("returns help when no subcommand is given", async () => {
    expect(await issueCommand([], teamCtx)).toContain(ISSUE_HELP);
  });
  it("returns a structured error (not a throw) for an unknown subcommand", async () => {
    const result = await issueCommand(["frobnicate"], teamCtx);
    expect(result).toContain("Unknown issue subcommand: frobnicate");
  });
});

describe("issue list", () => {
  function issuesResponse(nodes: unknown[], hasNextPage = false) {
    return { issues: { nodes, pageInfo: { hasNextPage } } };
  }
  const oneIssue = { identifier: "ENG-1", title: "T", state: { name: "Todo" }, assignee: null };

  it("builds an assignee filter for --assignee me", async () => {
    mockedResolveUser.mockResolvedValue({ id: "u-me", displayName: "Me" });
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));

    await issueCommand(["list", "--assignee", "me"], teamCtx);

    expect(mockedResolveUser).toHaveBeenCalledWith("me");
    const vars = mockedGql.mock.calls[0][1] as { filter: Record<string, unknown> };
    expect(vars.filter.assignee).toEqual({ id: { eq: "u-me" } });
  });

  it("builds a null assignee filter for --assignee none without resolving a user", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    await issueCommand(["list", "--assignee", "none"], teamCtx);
    const vars = mockedGql.mock.calls[0][1] as { filter: Record<string, unknown> };
    expect(vars.filter.assignee).toEqual({ null: true });
    expect(mockedResolveUser).not.toHaveBeenCalled();
  });

  it("uses a type filter for a state-type value without resolving a state", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    await issueCommand(["list", "--state", "started"], teamCtx);
    const vars = mockedGql.mock.calls[0][1] as { filter: Record<string, unknown> };
    expect(vars.filter.state).toEqual({ type: { eq: "started" } });
    expect(mockedResolveState).not.toHaveBeenCalled();
  });

  it("resolves a named state to an id filter when a team is in context", async () => {
    mockedResolveState.mockResolvedValue({ id: "st-x", name: "In Review", type: "started" });
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    await issueCommand(["list", "--state", "In Review"], teamCtx);
    const vars = mockedGql.mock.calls[0][1] as { filter: Record<string, unknown> };
    expect(vars.filter.state).toEqual({ id: { eq: "st-x" } });
  });

  it("filters a named state by name when there is no team context", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    await issueCommand(["list", "--state", "In Review"]);
    const vars = mockedGql.mock.calls[0][1] as { filter: Record<string, unknown> };
    expect(vars.filter.state).toEqual({ name: { eqIgnoreCase: "In Review" } });
  });

  it("maps --priority to its numeric filter", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    await issueCommand(["list", "--priority", "high"], teamCtx);
    const vars = mockedGql.mock.calls[0][1] as { filter: Record<string, unknown> };
    expect(vars.filter.priority).toEqual({ eq: 2 });
  });

  it("converts --updated-since to an ISO duration filter", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    await issueCommand(["list", "--updated-since", "2w"], teamCtx);
    const vars = mockedGql.mock.calls[0][1] as { filter: Record<string, unknown> };
    expect(vars.filter.updatedAt).toEqual({ gt: "-P2W" });
  });

  it("clamps --limit to the 250 ceiling", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    await issueCommand(["list", "--limit", "999"], teamCtx);
    expect((mockedGql.mock.calls[0][1] as { first: number }).first).toBe(250);
  });

  it("passes a small --limit through", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    await issueCommand(["list", "--limit", "5"], teamCtx);
    expect((mockedGql.mock.calls[0][1] as { first: number }).first).toBe(5);
  });

  it("emits a scope line describing the active filters", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue]));
    const result = await issueCommand(["list", "--priority", "high"], teamCtx);
    expect(result).toContain("scope:");
    expect(result).toContain("team: ENG");
    expect(result).toContain("priority: high");
  });

  it("echoes the filters in the empty state", async () => {
    mockedGql.mockResolvedValue(issuesResponse([]));
    const result = await issueCommand(["list", "--priority", "high"], teamCtx);
    expect(result).toContain("issues: 0 found matching");
    expect(result).toContain("team: ENG");
    expect(result).toContain("priority: high");
  });

  it("renders a (more available) count line when there is a next page", async () => {
    mockedGql.mockResolvedValue(issuesResponse([oneIssue], true));
    const result = await issueCommand(["list"], teamCtx);
    expect(result).toContain("count: 1 (more available)");
    expect(result).toContain("issue list --limit");
  });

  it("threads --fields selections into the query and the rendered rows", async () => {
    mockedGql.mockResolvedValue(
      issuesResponse([
        { identifier: "ENG-1", title: "T", state: { name: "Todo" }, assignee: null, labels: { nodes: [{ name: "bug" }] }, priority: 2 },
      ]),
    );
    const result = await issueCommand(["list", "--fields", "labels,priority"], teamCtx);
    const query = mockedGql.mock.calls[0][0] as string;
    expect(query).toContain("labels { nodes { name } }");
    expect(query).toContain("priority");
    expect(result).toContain("bug");
    expect(result).toContain("high");
  });

  it("rejects an unknown --fields value", async () => {
    await expect(issueCommand(["list", "--fields", "nonexistent"], teamCtx)).rejects.toThrow(AxiError);
  });

  it("rejects the renamed --status flag with a targeted hint", async () => {
    await expect(issueCommand(["list", "--status", "open"], teamCtx)).rejects.toThrow(
      /--status was renamed; use --state instead/,
    );
  });
});

describe("issue view", () => {
  function viewResponse(overrides: Record<string, unknown> = {}) {
    return {
      issue: {
        identifier: "ENG-1",
        title: "Fix login",
        description: "short body",
        url: "https://linear.app/acme/issue/ENG-1",
        branchName: "eng-1-fix",
        state: { name: "In Progress", type: "started" },
        assignee: { displayName: "Ada" },
        team: { key: "ENG" },
        project: null,
        cycle: null,
        labels: { nodes: [] },
        parent: null,
        children: { nodes: [] },
        relations: { nodes: [] },
        inverseRelations: { nodes: [] },
        comments: { nodes: [] },
        attachments: { nodes: [] },
        priority: 2,
        estimate: null,
        dueDate: null,
        updatedAt: "2026-01-01T00:00:00Z",
        ...overrides,
      },
    };
  }

  it("throws NOT_FOUND when the issue is missing", async () => {
    mockedGql.mockResolvedValue({ issue: null });
    try {
      await issueCommand(["view", "ENG-1"], teamCtx);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("NOT_FOUND");
    }
  });

  it("renders comment and sub-issue aggregate counts", async () => {
    mockedGql.mockResolvedValue(
      viewResponse({
        children: { nodes: [{ identifier: "ENG-2" }, { identifier: "ENG-3" }] },
        comments: { nodes: [{ id: "c1" }, { id: "c2" }] },
      }),
    );
    const result = await issueCommand(["view", "ENG-1"], teamCtx);
    expect(result).toContain("comments: 2");
    // TOON quotes values containing commas.
    expect(result).toMatch(/sub_issues: "?ENG-2,ENG-3"?/);
  });

  it("renders blocked_by and blocks from relations", async () => {
    mockedGql.mockResolvedValue(
      viewResponse({
        relations: {
          nodes: [{ id: "r1", type: "blocks", relatedIssue: { identifier: "ENG-9" } }],
        },
        inverseRelations: {
          nodes: [{ id: "r2", type: "blocks", issue: { identifier: "ENG-8" } }],
        },
      }),
    );
    const result = await issueCommand(["view", "ENG-1"], teamCtx);
    expect(result).toContain("blocked_by: ENG-8");
    expect(result).toContain("blocks: ENG-9");
    expect(result).toContain("relates_to: none");
    expect(result).toContain("duplicate_of: none");
  });

  it("passes the full description through with --full", async () => {
    const longDescription = "A".repeat(1500);
    mockedGql.mockResolvedValue(viewResponse({ description: longDescription }));

    const truncated = await issueCommand(["view", "ENG-1"], teamCtx);
    expect(truncated).toContain("truncated");

    mockedGql.mockResolvedValue(viewResponse({ description: longDescription }));
    const full = await issueCommand(["view", "ENG-1", "--full"], teamCtx);
    expect(full).not.toContain("truncated");
  });
});

describe("issue create", () => {
  const createResponse = {
    issueCreate: {
      success: true,
      issue: {
        identifier: "ENG-9",
        title: "New",
        url: "https://linear.app/acme/issue/ENG-9",
        state: { name: "Todo" },
        assignee: { displayName: "Me" },
        labels: { nodes: [{ name: "bug" }, { name: "ui" }] },
        project: { name: "Ship" },
        parent: { identifier: "ENG-1" },
        cycle: null,
        priority: 2,
        estimate: 2,
        dueDate: "2026-09-01",
      },
    },
  };

  it("requires a team", async () => {
    await expect(issueCommand(["create", "--title", "New"])).rejects.toThrow(/--team is required/);
    expect(mockedGql).not.toHaveBeenCalled();
  });

  it("requires a title", async () => {
    await expect(issueCommand(["create"], teamCtx)).rejects.toThrow(/--title is required/);
    expect(mockedGql).not.toHaveBeenCalled();
  });

  it("rejects another flag in place of the title value", async () => {
    await expect(
      issueCommand(["create", "--title", "--priority", "high"], teamCtx),
    ).rejects.toThrow("--title requires a value");
    expect(mockedGql).not.toHaveBeenCalled();
  });

  it("resolves references and feeds their ids into the mutation input", async () => {
    mockedResolveUser.mockResolvedValue({ id: "u-me", displayName: "Me" });
    mockedGql.mockResolvedValue(createResponse);

    await issueCommand(["create", "--title", "New", "--assignee", "me"], teamCtx);

    expect(mockedResolveUser).toHaveBeenCalledWith("me");
    const input = (mockedGql.mock.calls[0][1] as { input: Record<string, unknown> }).input;
    expect(input.teamId).toBe(TEAM.id);
    expect(input.title).toBe("New");
    expect(input.assigneeId).toBe("u-me");
  });

  it("collects repeated --label values into a labelIds array", async () => {
    mockedResolveLabel.mockImplementation(async (name: string) => ({ id: `lbl-${name}`, name }));
    mockedGql.mockResolvedValue(createResponse);

    await issueCommand(["create", "--title", "New", "--label", "bug", "--label", "ui"], teamCtx);

    const input = (mockedGql.mock.calls[0][1] as { input: Record<string, unknown> }).input;
    expect(input.labelIds).toEqual(["lbl-bug", "lbl-ui"]);
  });

  it("echoes fields that were set on create", async () => {
    mockedResolveUser.mockResolvedValue({ id: "u-me", displayName: "Me" });
    mockedResolveLabel.mockImplementation(async (name: string) => ({ id: `lbl-${name}`, name }));
    mockedResolveProject.mockResolvedValue({ id: "p1", name: "Ship" });
    mockedGql
      .mockResolvedValueOnce(coreResponse()) // parent lookup
      .mockResolvedValueOnce(createResponse);

    const out = await issueCommand(
      [
        "create",
        "--title",
        "New",
        "--assignee",
        "me",
        "--label",
        "bug",
        "--project",
        "Ship",
        "--parent",
        "ENG-1",
        "--priority",
        "high",
      ],
      teamCtx,
    );

    expect(out).toContain("assignee: Me");
    expect(out).toMatch(/labels: .*bug/);
    expect(out).toContain("project: Ship");
    expect(out).toContain("parent: ENG-1");
    expect(out).toContain("priority: high");
    // Unset axes are omitted from the echo.
    expect(out).not.toContain("estimate:");
  });

  it("creates with --blocked-by and echoes the relation", async () => {
    mockedGql
      .mockResolvedValueOnce(createResponse)
      .mockResolvedValueOnce({
        issue: { relations: { nodes: [] }, inverseRelations: { nodes: [] } },
      })
      .mockResolvedValueOnce({
        issueRelationCreate: { success: true, issueRelation: { id: "rel-1" } },
      });

    const out = await issueCommand(
      ["create", "--title", "New", "--blocked-by", "ENG-1"],
      teamCtx,
    );

    expect(mockedGql.mock.calls[2][0]).toContain("issueRelationCreate");
    const input = (mockedGql.mock.calls[2][1] as { input: Record<string, unknown> }).input;
    expect(input).toMatchObject({ type: "blocks", issueId: "ENG-1", relatedIssueId: "ENG-9" });
    expect(out).toContain("blocked_by: ENG-1");
  });

  it("reads the description from a --body-file", async () => {
    await withBodyFile("multi\nline\nbody", async (file) => {
      mockedGql.mockResolvedValue(createResponse);
      await issueCommand(["create", "--title", "New", "--body-file", file], teamCtx);
      const input = (mockedGql.mock.calls[0][1] as { input: Record<string, unknown> }).input;
      expect(input.description).toBe("multi\nline\nbody");
    });
  });
});

describe("issue update", () => {
  it("errors when there is nothing to update", async () => {
    mockedGql.mockResolvedValueOnce(coreResponse());
    await expect(issueCommand(["update", "ENG-1"], teamCtx)).rejects.toThrow(/Nothing to update/);
  });

  it("routes +label / -label to added and removed label ids", async () => {
    mockedResolveLabel.mockImplementation(async (name: string) => ({ id: `lbl-${name}`, name }));
    mockedGql.mockResolvedValueOnce(coreResponse()).mockResolvedValueOnce(updateResponse);

    await issueCommand(["update", "ENG-1", "--label", "+bug", "--label", "-old"], teamCtx);

    const input = (mockedGql.mock.calls[1][1] as { input: Record<string, unknown> }).input;
    expect(input.addedLabelIds).toEqual(["lbl-bug"]);
    expect(input.removedLabelIds).toEqual(["lbl-old"]);
  });

  it("finds the issue id after value-taking flags", async () => {
    mockedGql.mockResolvedValueOnce(coreResponse({ identifier: "DEF-2" })).mockResolvedValueOnce(updateResponse);

    await issueCommand(["update", "--title", "ABC-1", "DEF-2"], teamCtx);

    expect(mockedGql.mock.calls[0][1]).toEqual({ id: "DEF-2" });
    expect((mockedGql.mock.calls[1][1] as { input: Record<string, unknown> }).input.title).toBe("ABC-1");
  });

  it("clears the assignee for --assignee none", async () => {
    mockedGql.mockResolvedValueOnce(coreResponse()).mockResolvedValueOnce(updateResponse);
    await issueCommand(["update", "ENG-1", "--assignee", "none"], teamCtx);
    const input = (mockedGql.mock.calls[1][1] as { input: Record<string, unknown> }).input;
    expect(input.assigneeId).toBeNull();
  });

  it("echoes only the fields that were updated", async () => {
    mockedGql.mockResolvedValueOnce(coreResponse()).mockResolvedValueOnce({
      issueUpdate: {
        success: true,
        issue: {
          identifier: "ENG-1",
          title: "Renamed",
          url: "u",
          state: { name: "Todo", type: "unstarted" },
          assignee: null,
          labels: { nodes: [] },
          project: null,
          parent: null,
          cycle: null,
          priority: 0,
          estimate: null,
          dueDate: null,
        },
      },
    });

    const out = await issueCommand(["update", "ENG-1", "--title", "Renamed"], teamCtx);
    expect(out).toContain("title: Renamed");
    expect(out).not.toContain("assignee:");
    expect(out).not.toContain("labels:");
  });

  it("adds a blocks relation with +/- grammar and is idempotent when already present", async () => {
    mockedGql
      .mockResolvedValueOnce(coreResponse())
      .mockResolvedValueOnce({
        issue: {
          relations: {
            nodes: [{ id: "r1", type: "blocks", relatedIssue: { identifier: "ENG-2" } }],
          },
          inverseRelations: { nodes: [] },
        },
      });

    const out = await issueCommand(["update", "ENG-1", "--blocks", "+ENG-2"], teamCtx);
    expect(out).toContain("Already blocks ENG-2");
    expect(out).toContain("blocks: ENG-2");
    // No issueUpdate and no issueRelationCreate — relation already existed.
    expect(mockedGql.mock.calls.some((c) => String(c[0]).includes("issueRelationCreate"))).toBe(
      false,
    );
  });
});

describe("issue close", () => {
  it("is an idempotent no-op when already completed", async () => {
    mockedGql.mockResolvedValueOnce(coreResponse({ stateType: "completed", stateName: "Done" }));
    const result = await issueCommand(["close", "ENG-1"], teamCtx);
    expect(result).toContain("Already Done");
    expect(mockedGql).toHaveBeenCalledTimes(1);
  });

  it("targets the canceled state with --cancel", async () => {
    mockedGql.mockResolvedValueOnce(coreResponse({ stateType: "canceled", stateName: "Canceled" }));
    const result = await issueCommand(["close", "ENG-1", "--cancel"], teamCtx);
    expect(result).toContain("Already Canceled");
    expect(mockedGql).toHaveBeenCalledTimes(1);
  });

  it("resolves the completed state and updates on the normal path", async () => {
    mockedResolveState.mockResolvedValue({ id: "s-done", name: "Done", type: "completed" });
    mockedGql.mockResolvedValueOnce(coreResponse({ stateType: "started" })).mockResolvedValueOnce(updateResponse);

    await issueCommand(["close", "ENG-1"], teamCtx);

    expect(mockedResolveState).toHaveBeenCalledWith(expect.objectContaining({ key: "ENG" }), "completed");
    const input = (mockedGql.mock.calls[1][1] as { input: Record<string, unknown> }).input;
    expect(input.stateId).toBe("s-done");
  });
});

describe("issue reopen", () => {
  it("is a no-op when the issue is already open", async () => {
    mockedGql.mockResolvedValueOnce(coreResponse({ stateType: "started", stateName: "In Progress" }));
    const result = await issueCommand(["reopen", "ENG-1"], teamCtx);
    expect(result).toContain("Already open");
    expect(mockedGql).toHaveBeenCalledTimes(1);
  });
});

describe("issue comment", () => {
  it("requires a body", async () => {
    await expect(issueCommand(["comment", "ENG-1"], teamCtx)).rejects.toThrow(AxiError);
    expect(mockedGql).not.toHaveBeenCalled();
  });

  it("threads a reply via parentId", async () => {
    mockedGql
      .mockResolvedValueOnce(coreResponse())
      .mockResolvedValueOnce({
        commentCreate: { success: true, comment: { id: "c9", body: "hi", createdAt: "2026-01-01T00:00:00Z", user: { displayName: "Me" } } },
      });

    await issueCommand(["comment", "ENG-1", "--body", "hi", "--reply-to", "c1"], teamCtx);

    const input = (mockedGql.mock.calls[1][1] as { input: Record<string, unknown> }).input;
    expect(input.body).toBe("hi");
    expect(input.parentId).toBe("c1");
  });
});

describe("issue comments", () => {
  it("orders roots by creation time with replies nested and orphans appended", async () => {
    mockedGql.mockResolvedValue({
      issue: {
        identifier: "ENG-1",
        comments: {
          nodes: [
            { id: "r2", body: "root two", createdAt: "2026-01-02T00:00:00Z", user: { displayName: "B" }, parent: null },
            { id: "r1", body: "root one", createdAt: "2026-01-01T00:00:00Z", user: { displayName: "A" }, parent: null },
            { id: "reply1", body: "reply to one", createdAt: "2026-01-01T05:00:00Z", user: { displayName: "C" }, parent: { id: "r1" } },
            { id: "orphan", body: "orphan reply", createdAt: "2026-01-03T00:00:00Z", user: { displayName: "D" }, parent: { id: "gone" } },
          ],
        },
      },
    });

    const result = await issueCommand(["comments", "ENG-1"], teamCtx);
    const order = ["r1", "reply1", "r2", "orphan"].map((id) => result.indexOf(id));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order.every((i) => i >= 0)).toBe(true);
  });

  it("renders an explicit empty state", async () => {
    mockedGql.mockResolvedValue({ issue: { identifier: "ENG-1", comments: { nodes: [] } } });
    const result = await issueCommand(["comments", "ENG-1"], teamCtx);
    expect(result).toContain("comments: 0 on ENG-1");
  });
});

describe("issue branch", () => {
  it("prints the bare branch name", async () => {
    mockedGql.mockResolvedValue(coreResponse({ branchName: "eng-1-fix-login" }));
    const result = await issueCommand(["branch", "ENG-1"], teamCtx);
    expect(result).toBe("eng-1-fix-login");
  });
});

describe("issue start", () => {
  it("assigns me, moves to started, and checks out the branch", async () => {
    mockedResolveUser.mockResolvedValue({ id: "me-id", displayName: "Me" });
    mockedResolveState.mockResolvedValue({ id: "s-started", name: "In Progress", type: "started" });
    mockedGql
      .mockResolvedValueOnce(coreResponse({ stateType: "unstarted", assignee: null }))
      .mockResolvedValueOnce(updateResponse);

    const result = await issueCommand(["start", "ENG-1"], teamCtx);

    const input = (mockedGql.mock.calls[1][1] as { input: Record<string, unknown> }).input;
    expect(input.assigneeId).toBe("me-id");
    expect(input.stateId).toBe("s-started");

    // A git checkout was attempted.
    const gitCalls = mockedExecFile.mock.calls.map((c) => c[1] as string[]);
    expect(gitCalls.some((args) => args.includes("checkout"))).toBe(true);
    expect(result).toContain("branch: eng-1-fix-login");
  });

  it("skips git entirely with --no-branch", async () => {
    mockedResolveUser.mockResolvedValue({ id: "me-id", displayName: "Me" });
    mockedResolveState.mockResolvedValue({ id: "s-started", name: "In Progress", type: "started" });
    mockedGql
      .mockResolvedValueOnce(coreResponse({ stateType: "unstarted", assignee: null }))
      .mockResolvedValueOnce(updateResponse);

    const result = await issueCommand(["start", "ENG-1", "--no-branch"], teamCtx);

    expect(mockedExecFile).not.toHaveBeenCalled();
    expect(result).toContain("(skipped)");
  });

  it("throws after the Linear update when Git checkout fails", async () => {
    mockedResolveUser.mockResolvedValue({ id: "me-id", displayName: "Me" });
    mockedResolveState.mockResolvedValue({ id: "s-started", name: "In Progress", type: "started" });
    mockedGql
      .mockResolvedValueOnce(coreResponse({ stateType: "unstarted", assignee: null }))
      .mockResolvedValueOnce(updateResponse);
    mockedExecFile
      .mockImplementationOnce(((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
        (cb as (e: Error | null, out: string, err: string) => void)(null, "", "");
        return {} as never;
      }) as never)
      .mockImplementationOnce(((_cmd: string, _args: string[], _opts: unknown, cb: unknown) => {
        (cb as (e: Error | null, out: string, err: string) => void)(new Error("failed"), "", "dirty worktree");
        return {} as never;
      }) as never);

    await expect(issueCommand(["start", "ENG-1"], teamCtx)).rejects.toMatchObject({
      code: "UNKNOWN",
      message: expect.stringContaining("Issue was started"),
    });
    expect(mockedGql).toHaveBeenCalledTimes(2);
  });
});

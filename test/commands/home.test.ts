import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
}));

import { gqlQuery } from "../../src/linear.js";
import { homeCommand } from "../../src/commands/home.js";
import { authRequiredError } from "../../src/errors.js";
import type { LinearContext } from "../../src/context.js";

const mockedGql = vi.mocked(gqlQuery);

function homeData(nodes: unknown[], hasNextPage = false) {
  return {
    viewer: {
      displayName: "Ada Lovelace",
      organization: { name: "Acme Inc" },
      assignedIssues: { nodes, pageInfo: { hasNextPage } },
    },
  };
}

const activeIssue = {
  identifier: "ENG-1",
  title: "Fix login",
  state: { name: "In Progress" },
  team: { key: "ENG" },
};

describe("homeCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("renders the workspace and viewer lines", async () => {
    mockedGql.mockResolvedValue(homeData([]));
    const result = await homeCommand([]);
    expect(result).toContain("workspace: Acme Inc");
    expect(result).toContain("me: Ada Lovelace");
  });

  it("renders the my_issues list when there are active issues", async () => {
    mockedGql.mockResolvedValue(homeData([activeIssue]));
    const result = await homeCommand([]);
    expect(result).toContain("my_issues");
    expect(result).toContain("ENG-1");
    expect(result).toContain("Fix login");
  });

  it("renders an explicit empty state when there are no active issues", async () => {
    mockedGql.mockResolvedValue(homeData([]));
    const result = await homeCommand([]);
    expect(result).toContain("my_issues: 0 active");
  });

  it("adds a full-list hint when there is a next page", async () => {
    mockedGql.mockResolvedValue(homeData([activeIssue], true));
    const result = await homeCommand([]);
    expect(result).toContain("issue list --assignee me");
  });

  it("omits the full-list hint when there is no next page", async () => {
    mockedGql.mockResolvedValue(homeData([activeIssue], false));
    const result = await homeCommand([]);
    expect(result).not.toContain("issue list --assignee me");
  });

  it("includes the team and branch issue when provided in context", async () => {
    mockedGql.mockResolvedValue(homeData([]));
    const ctx: LinearContext = { team: { team: "ENG", source: "flag" }, branchIssue: "ENG-9" };
    const result = await homeCommand([], ctx);
    expect(result).toContain("team: ENG");
    expect(result).toContain("branch_issue: ENG-9");
  });

  it("renders an AUTH_REQUIRED failure as structured output instead of throwing", async () => {
    mockedGql.mockRejectedValue(authRequiredError());
    const result = await homeCommand([]);
    expect(result).toContain("error: Linear API key required");
    expect(result).toContain("code: AUTH_REQUIRED");
    expect(result).toContain("LINEAR_API_KEY");
  });

  it("rethrows non-AxiError failures", async () => {
    mockedGql.mockRejectedValue(new Error("boom"));
    await expect(homeCommand([])).rejects.toThrow("boom");
  });
});

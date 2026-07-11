import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

import { gqlQuery } from "../../src/linear.js";
import { searchCommand, SEARCH_HELP } from "../../src/commands/search.js";

const mockedGql = vi.mocked(gqlQuery);

describe("searchCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help for --help", async () => {
    expect(await searchCommand(["--help"])).toBe(SEARCH_HELP);
  });

  it("HELP ends with an examples section of linear-axi lines", () => {
    const idx = SEARCH_HELP.indexOf("examples:");
    expect(idx).toBeGreaterThan(-1);
    const lines = SEARCH_HELP.slice(idx).split("\n").slice(1).filter((l) => l.trim());
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(line).toMatch(/^ {2}linear-axi /);
  });

  it("requires search text", async () => {
    await expect(searchCommand([])).rejects.toThrow(/Search text is required/);
  });

  it("renders results with count and schema", async () => {
    mockedGql.mockResolvedValue({
      searchIssues: {
        nodes: [
          {
            identifier: "ENG-12",
            title: "Login bug",
            state: { name: "In Progress" },
            team: { key: "ENG" },
            assignee: { displayName: "Alice" },
          },
        ],
        pageInfo: { hasNextPage: false },
      },
    } as never);

    const out = await searchCommand(["login"]);
    expect(out).toContain("count: 1");
    expect(out).toContain("ENG-12");
    expect(out).toContain("Login bug");
    expect(out).toContain("Alice");
    expect(mockedGql.mock.calls[0][1]).toMatchObject({ term: "login", first: 25 });
  });

  it("renders a definitive empty state echoing the term", async () => {
    mockedGql.mockResolvedValue({
      searchIssues: { nodes: [], pageInfo: { hasNextPage: false } },
    } as never);

    const out = await searchCommand(["nothing"]);
    expect(out).toContain('results: 0 found for "nothing"');
  });

  it("honors --limit", async () => {
    mockedGql.mockResolvedValue({
      searchIssues: { nodes: [], pageInfo: { hasNextPage: false } },
    } as never);

    await searchCommand(["x", "--limit", "50"]);
    expect(mockedGql.mock.calls[0][1]).toMatchObject({ first: 50 });
  });

  it("rejects unknown flags", async () => {
    await expect(searchCommand(["x", "--bogus"])).rejects.toThrow(/Unknown flag --bogus/);
  });
});

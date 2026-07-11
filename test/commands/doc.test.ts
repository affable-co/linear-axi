import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

import { gqlQuery } from "../../src/linear.js";
import { docCommand, DOC_HELP } from "../../src/commands/doc.js";

const mockedGql = vi.mocked(gqlQuery);

describe("docCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help for --help and no args", async () => {
    expect(await docCommand(["--help"])).toBe(DOC_HELP);
    expect(await docCommand([])).toBe(DOC_HELP);
  });

  it("HELP ends with an examples section of linear-axi lines", () => {
    const idx = DOC_HELP.indexOf("examples:");
    expect(idx).toBeGreaterThan(-1);
    const lines = DOC_HELP.slice(idx).split("\n").slice(1).filter((l) => l.trim());
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(line).toMatch(/^ {2}linear-axi /);
  });

  it("lists documents with count and schema fields", async () => {
    mockedGql.mockResolvedValue({
      documents: {
        nodes: [
          { id: "doc-1", title: "Runbook", project: { name: "Infra" }, updatedAt: new Date().toISOString() },
        ],
        pageInfo: { hasNextPage: false },
      },
    } as never);

    const out = await docCommand(["list"]);
    expect(out).toContain("count: 1");
    expect(out).toContain("Runbook");
    expect(out).toContain("Infra");
  });

  it("renders an explicit empty state", async () => {
    mockedGql.mockResolvedValue({
      documents: { nodes: [], pageInfo: { hasNextPage: false } },
    } as never);

    const out = await docCommand(["list", "--query", "nope"]);
    expect(out).toContain("docs: 0 found");
    expect(out).toContain("query: nope");
  });

  it("views a document with truncated content", async () => {
    mockedGql.mockResolvedValue({
      document: {
        id: "doc-1",
        title: "Runbook",
        url: "https://linear.app/x/document/doc-1",
        updatedAt: new Date().toISOString(),
        content: "hello world",
        creator: { displayName: "Alice" },
        project: { name: "Infra" },
      },
    } as never);

    const out = await docCommand(["view", "doc-1"]);
    expect(out).toContain("Runbook");
    expect(out).toContain("Alice");
    expect(out).toContain("hello world");
  });

  it("creates a document from --title and --body", async () => {
    mockedGql.mockResolvedValue({
      documentCreate: { success: true, document: { id: "doc-9", title: "New", url: "u" } },
    } as never);

    const out = await docCommand(["create", "--title", "New", "--body", "content"]);
    expect(out).toContain("doc-9");
    expect(out).toContain("New");
    const input = mockedGql.mock.calls[0][1] as { input: Record<string, unknown> };
    expect(input.input).toMatchObject({ title: "New", content: "content" });
  });

  it("rejects create without --title", async () => {
    await expect(docCommand(["create", "--body", "x"])).rejects.toThrow(/--title is required/);
  });

  it("rejects update with no fields", async () => {
    await expect(docCommand(["update", "doc-1"])).rejects.toThrow(/Nothing to update/);
  });

  it("rejects unknown flags", async () => {
    await expect(docCommand(["list", "--bogus"])).rejects.toThrow(/Unknown flag --bogus/);
  });
});

import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

vi.mock("../../src/stdin.js", () => ({
  readStdin: vi.fn(),
  isStdinTTY: vi.fn(),
}));

import { gqlRaw } from "../../src/linear.js";
import { isStdinTTY, readStdin } from "../../src/stdin.js";
import { apiCommand, API_HELP } from "../../src/commands/api.js";

const mockedGqlRaw = vi.mocked(gqlRaw);
const mockedTTY = vi.mocked(isStdinTTY);
const mockedReadStdin = vi.mocked(readStdin);

describe("apiCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedTTY.mockReturnValue(true);
  });

  it("returns help for --help", async () => {
    expect(await apiCommand(["--help"])).toBe(API_HELP);
  });

  it("HELP ends with an examples section of linear-axi lines", () => {
    const idx = API_HELP.indexOf("examples:");
    expect(idx).toBeGreaterThan(-1);
    const lines = API_HELP.slice(idx).split("\n").slice(1).filter((l) => l.trim());
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(line).toMatch(/^ {2}linear-axi /);
  });

  it("HELP documents unwrapped JSON output and includes a mutation example", () => {
    expect(API_HELP).toContain('no {"data":');
    expect(API_HELP).toContain("organization");
    expect(API_HELP).toContain("ABC-123");
    expect(API_HELP).not.toContain("issueRelationCreate");
  });

  it("throws immediately (never hangs) when no query and stdin is a TTY", async () => {
    mockedTTY.mockReturnValue(true);
    await expect(apiCommand([])).rejects.toThrow(/GraphQL query is required/);
    expect(mockedReadStdin).not.toHaveBeenCalled();
  });

  it("reads the query from stdin when piped", async () => {
    mockedTTY.mockReturnValue(false);
    mockedReadStdin.mockResolvedValue("{ viewer { id } }");
    mockedGqlRaw.mockResolvedValue({ data: { viewer: { id: "u1" } }, status: 200 } as never);

    const out = await apiCommand([]);
    expect(mockedReadStdin).toHaveBeenCalled();
    expect(out).toBe(JSON.stringify({ viewer: { id: "u1" } }));
  });

  it("rejects invalid --input JSON", async () => {
    await expect(apiCommand(["{ viewer { id } }", "--input", "{bad"])).rejects.toThrow(
      /Invalid --input JSON:/,
    );
  });

  it("parses --input into variables", async () => {
    mockedGqlRaw.mockResolvedValue({ data: { ok: true }, status: 200 } as never);

    await apiCommand(["query($id:String!){issue(id:$id){title}}", "--input", '{"id":"ABC-1"}']);
    expect(mockedGqlRaw).toHaveBeenCalledWith(
      "query($id:String!){issue(id:$id){title}}",
      { id: "ABC-1" },
    );
  });

  it("outputs raw compact JSON on success", async () => {
    mockedGqlRaw.mockResolvedValue({ data: { a: 1, b: [2, 3] }, status: 200 } as never);

    const out = await apiCommand(["{ a }"]);
    expect(out).toBe('{"a":1,"b":[2,3]}');
  });

  it("maps GraphQL errors to a structured throw", async () => {
    mockedGqlRaw.mockResolvedValue({
      errors: [{ message: "entity not found" }],
      status: 200,
    } as never);

    await expect(apiCommand(["{ x }"])).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects unknown flags", async () => {
    await expect(apiCommand(["{ x }", "--bogus"])).rejects.toThrow(/Unknown flag --bogus/);
  });
});

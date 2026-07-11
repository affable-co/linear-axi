import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

vi.mock("../../src/resolve.js", async (importActual) => {
  const actual = await importActual<typeof import("../../src/resolve.js")>();
  return { ...actual, resolveUser: vi.fn() };
});

import { gqlQuery } from "../../src/linear.js";
import { resolveUser } from "../../src/resolve.js";
import { userCommand, USER_HELP } from "../../src/commands/user.js";
import { AxiError } from "../../src/errors.js";

const mockedGql = vi.mocked(gqlQuery);
const mockedResolveUser = vi.mocked(resolveUser);

describe("userCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("router", () => {
    it("returns help for --help and no subcommand", async () => {
      expect(await userCommand(["--help"])).toBe(USER_HELP);
      expect(await userCommand([])).toBe(USER_HELP);
    });

    it("errors on unknown subcommand", async () => {
      const out = await userCommand(["bogus"]);
      expect(out).toContain("Unknown user subcommand: bogus");
    });
  });

  describe("list", () => {
    it("lists users with name/email/active", async () => {
      mockedGql.mockResolvedValue({
        users: {
          nodes: [
            { displayName: "Alice", email: "alice@x.co", active: true },
            { displayName: "Bob", email: "bob@x.co", active: false },
          ],
          pageInfo: { hasNextPage: false },
        },
      });

      const out = await userCommand(["list"]);
      expect(out).toContain("{name,email,active}");
      expect(out).toContain("Alice,alice@x.co,yes");
      expect(out).toContain("Bob,bob@x.co,no");
      expect(out).toContain("count: 2");
      expect(mockedGql).toHaveBeenCalledWith(expect.any(String), { filter: null, first: 100 });
    });

    it("passes a displayName filter for --query", async () => {
      mockedGql.mockResolvedValue({ users: { nodes: [], pageInfo: { hasNextPage: false } } });
      await userCommand(["list", "--query", "ali"]);
      expect(mockedGql).toHaveBeenCalledWith(expect.any(String), {
        filter: { displayName: { containsIgnoreCase: "ali" } },
        first: 100,
      });
    });

    it("shows explicit empty state", async () => {
      mockedGql.mockResolvedValue({ users: { nodes: [], pageInfo: { hasNextPage: false } } });
      const out = await userCommand(["list", "--query", "nope"]);
      expect(out).toContain("users: 0 found matching query: nope");
    });

    it("rejects unknown flags", async () => {
      await expect(userCommand(["list", "--bogus"])).rejects.toThrow(AxiError);
    });
  });

  describe("view", () => {
    beforeEach(() => {
      mockedResolveUser.mockResolvedValue({ id: "user-uuid", displayName: "Alice" });
    });

    it("renders profile with a precomputed open-issue count", async () => {
      mockedGql.mockResolvedValue({
        user: {
          displayName: "Alice",
          name: "alice",
          email: "alice@x.co",
          active: true,
          admin: false,
          createdAt: "2024-01-01T00:00:00.000Z",
          assignedIssues: { nodes: [{ identifier: "ENG-1" }, { identifier: "ENG-2" }], pageInfo: { hasNextPage: false } },
        },
      });

      const out = await userCommand(["view", "me"]);
      expect(out).toContain("name: Alice");
      expect(out).toContain("admin: no");
      expect(out).toContain("assigned_open: 2");
      expect(mockedResolveUser).toHaveBeenCalledWith("me");
      expect(mockedGql).toHaveBeenCalledWith(expect.any(String), { id: "user-uuid" });
    });

    it("caps the open-issue count with a 50+ marker", async () => {
      mockedGql.mockResolvedValue({
        user: {
          displayName: "Alice",
          name: "alice",
          email: "alice@x.co",
          active: true,
          admin: false,
          createdAt: "2024-01-01T00:00:00.000Z",
          assignedIssues: {
            nodes: Array.from({ length: 50 }, (_, i) => ({ identifier: `ENG-${i}` })),
            pageInfo: { hasNextPage: true },
          },
        },
      });

      const out = await userCommand(["view", "me"]);
      expect(out).toContain("assigned_open: 50+");
    });

    it("requires a user reference", async () => {
      await expect(userCommand(["view"])).rejects.toThrow(AxiError);
    });

    it("rejects unknown flags", async () => {
      await expect(userCommand(["view", "me", "--bogus"])).rejects.toThrow(AxiError);
    });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/auth.js", () => ({
  resolveApiCredential: vi.fn(),
}));

vi.mock("../../src/linear.js", () => ({
  gqlQuery: vi.fn(),
  gqlRaw: vi.fn(),
}));

import { resolveApiCredential } from "../../src/auth.js";
import { gqlQuery } from "../../src/linear.js";
import { authCommand, AUTH_HELP } from "../../src/commands/auth.js";

const mockedCredential = vi.mocked(resolveApiCredential);
const mockedGql = vi.mocked(gqlQuery);

describe("authCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns help for --help and no args", async () => {
    expect(await authCommand(["--help"])).toBe(AUTH_HELP);
    expect(await authCommand([])).toBe(AUTH_HELP);
  });

  it("verifies the credential and renders account details without the key", async () => {
    mockedCredential.mockReturnValue({ apiKey: "lin_api_secret", source: "environment" });
    mockedGql.mockResolvedValue({
      viewer: { displayName: "Ada", organization: { name: "Acme" } },
    });

    const output = await authCommand(["status"]);

    expect(mockedGql.mock.calls[0][0]).toContain("viewer");
    expect(output).toContain("status: authenticated");
    expect(output).toContain("credential_source: environment");
    expect(output).toContain("user: Ada");
    expect(output).toContain("workspace: Acme");
    expect(output).not.toContain("lin_api_secret");
  });

  it("rejects flags on status", async () => {
    await expect(authCommand(["status", "--json"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("rejects unknown subcommands with the status command inline", async () => {
    await expect(authCommand(["login"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      suggestions: [expect.stringContaining("auth status")],
    });
  });
});

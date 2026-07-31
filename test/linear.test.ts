import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/auth.js", () => ({
  resolveApiKey: vi.fn(() => "lin_api_test"),
}));

import { gqlRaw, LINEAR_REQUEST_TIMEOUT_MS } from "../src/linear.js";

describe("gqlRaw", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches an abort signal to every request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { viewer: { id: "u1" } } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await gqlRaw("query { viewer { id } }");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(LINEAR_REQUEST_TIMEOUT_MS).toBe(30_000);
  });

  it("maps request timeouts to NETWORK_ERROR", async () => {
    const timeout = Object.assign(new Error("timed out"), { name: "TimeoutError" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeout));

    await expect(gqlRaw("query { viewer { id } }")).rejects.toMatchObject({
      code: "NETWORK_ERROR",
      message: expect.stringContaining("timed out after 30s"),
    });
  });
});

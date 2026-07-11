import { describe, it, expect } from "vitest";
import {
  AxiError,
  exitCodeForError,
  mapLinearError,
  authRequiredError,
  networkError,
  type LinearGraphQLError,
} from "../src/errors.js";

function gql(message: string, ext?: LinearGraphQLError["extensions"]): LinearGraphQLError[] {
  return [{ message, ...(ext ? { extensions: ext } : {}) }];
}

describe("mapLinearError", () => {
  it("maps HTTP 429 to RATE_LIMITED", () => {
    const err = mapLinearError(undefined, 429);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("maps a RATELIMITED extension code to RATE_LIMITED", () => {
    const err = mapLinearError(gql("slow down", { code: "RATELIMITED" }), 200);
    expect(err.code).toBe("RATE_LIMITED");
  });

  it("includes a reset hint from the rate-limit reset timestamp", () => {
    const resetMs = String(Date.now() + 90_000);
    const err = mapLinearError(undefined, 429, resetMs);
    expect(err.code).toBe("RATE_LIMITED");
    expect(err.message).toMatch(/resets in \d+s/);
  });

  it("maps HTTP 401 to AUTH_REQUIRED", () => {
    const err = mapLinearError(undefined, 401);
    expect(err.code).toBe("AUTH_REQUIRED");
  });

  it("maps an AUTHENTICATION_ERROR extension code to AUTH_REQUIRED", () => {
    const err = mapLinearError(gql("bad key", { code: "AUTHENTICATION_ERROR" }), 200);
    expect(err.code).toBe("AUTH_REQUIRED");
  });

  it("maps HTTP 403 to FORBIDDEN", () => {
    const err = mapLinearError(gql("nope"), 403);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toContain("nope");
  });

  it("maps an entity-not-found message to NOT_FOUND", () => {
    const err = mapLinearError(gql("Entity not found: Issue"), 200);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toContain("Entity not found");
  });

  it("maps an INVALID_INPUT extension code to VALIDATION_ERROR", () => {
    const err = mapLinearError(gql("bad field", { code: "INVALID_INPUT" }), 200);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("maps a userError flag to VALIDATION_ERROR", () => {
    const err = mapLinearError(gql("invalid", { userError: true }), 200);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("maps HTTP 400 to VALIDATION_ERROR", () => {
    const err = mapLinearError(gql("bad request"), 400);
    expect(err.code).toBe("VALIDATION_ERROR");
  });

  it("prefers userPresentableMessage over the raw message", () => {
    const err = mapLinearError(
      gql("raw internal detail", { code: "INVALID_INPUT", userPresentableMessage: "Title is required" }),
      200,
    );
    expect(err.code).toBe("VALIDATION_ERROR");
    expect(err.message).toBe("Title is required");
  });

  it("falls back to UNKNOWN for unrecognized errors", () => {
    const err = mapLinearError(gql("something odd happened"), 200);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toBe("something odd happened");
  });

  it("synthesizes a message from the HTTP status when no error message is present", () => {
    const err = mapLinearError([], 500);
    expect(err.code).toBe("UNKNOWN");
    expect(err.message).toContain("HTTP 500");
  });
});

describe("authRequiredError", () => {
  it("returns an AUTH_REQUIRED AxiError with setup suggestions", () => {
    const err = authRequiredError();
    expect(err).toBeInstanceOf(AxiError);
    expect(err.code).toBe("AUTH_REQUIRED");
    expect(err.suggestions.join(" ")).toContain("LINEAR_API_KEY");
  });
});

describe("networkError", () => {
  it("returns a NETWORK_ERROR AxiError carrying the detail", () => {
    const err = networkError("ECONNREFUSED");
    expect(err.code).toBe("NETWORK_ERROR");
    expect(err.message).toContain("ECONNREFUSED");
  });
});

describe("exitCodeForError", () => {
  it("returns 2 for VALIDATION_ERROR", () => {
    expect(exitCodeForError(new AxiError("x", "VALIDATION_ERROR"))).toBe(2);
  });
  it("returns 1 for NOT_FOUND", () => {
    expect(exitCodeForError(new AxiError("x", "NOT_FOUND"))).toBe(1);
  });
  it("returns 1 for a non-AxiError", () => {
    expect(exitCodeForError(new Error("generic"))).toBe(1);
  });
});

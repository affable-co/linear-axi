import { describe, it, expect } from "vitest";
import {
  getFlag,
  takeFlag,
  hasFlag,
  takeBoolFlag,
  getAllFlags,
  getPositional,
  requireNumber,
  requirePositional,
  rejectUnknownFlags,
} from "../src/args.js";
import { AxiError } from "../src/errors.js";

describe("getFlag", () => {
  it("returns the value following the flag (space form)", () => {
    expect(getFlag(["--team", "ENG", "--state", "open"], "--team")).toBe("ENG");
  });

  it("returns the value from --flag=value form", () => {
    expect(getFlag(["--team=ENG", "--state", "open"], "--team")).toBe("ENG");
  });

  it("returns undefined when the flag is missing", () => {
    expect(getFlag(["--state", "open"], "--team")).toBeUndefined();
  });

  it("returns undefined when the flag is last with no value", () => {
    expect(getFlag(["--state", "open", "--team"], "--team")).toBeUndefined();
  });

  it("does not modify the args array", () => {
    const args = ["--team", "ENG"];
    getFlag(args, "--team");
    expect(args).toEqual(["--team", "ENG"]);
  });
});

describe("takeFlag", () => {
  it("returns the value and removes flag+value (space form)", () => {
    const args = ["--team", "ENG", "--state", "open"];
    expect(takeFlag(args, "--team")).toBe("ENG");
    expect(args).toEqual(["--state", "open"]);
  });

  it("returns the value and removes --flag=value form", () => {
    const args = ["--team=ENG", "--state", "open"];
    expect(takeFlag(args, "--team")).toBe("ENG");
    expect(args).toEqual(["--state", "open"]);
  });

  it("returns undefined and leaves args untouched when missing", () => {
    const args = ["--state", "open"];
    expect(takeFlag(args, "--team")).toBeUndefined();
    expect(args).toEqual(["--state", "open"]);
  });
});

describe("hasFlag", () => {
  it("returns true when present", () => {
    expect(hasFlag(["--full", "--comments"], "--full")).toBe(true);
  });
  it("returns false when absent", () => {
    expect(hasFlag(["--comments"], "--full")).toBe(false);
  });
  it("returns false for empty args", () => {
    expect(hasFlag([], "--full")).toBe(false);
  });
});

describe("takeBoolFlag", () => {
  it("returns true and removes the flag", () => {
    const args = ["--full", "--comments"];
    expect(takeBoolFlag(args, "--full")).toBe(true);
    expect(args).toEqual(["--comments"]);
  });
  it("returns false and leaves args untouched when absent", () => {
    const args = ["--comments"];
    expect(takeBoolFlag(args, "--full")).toBe(false);
    expect(args).toEqual(["--comments"]);
  });
});

describe("getAllFlags", () => {
  it("collects all values (space form)", () => {
    const args = ["--label", "bug", "--state", "open", "--label", "help wanted"];
    expect(getAllFlags(args, "--label")).toEqual(["bug", "help wanted"]);
  });
  it("collects all values (equals form)", () => {
    const args = ["--label=bug", "--state", "open", "--label=help wanted"];
    expect(getAllFlags(args, "--label")).toEqual(["bug", "help wanted"]);
  });
  it("returns empty when absent", () => {
    expect(getAllFlags(["--state", "open"], "--label")).toEqual([]);
  });
  it("skips a trailing flag with no value", () => {
    expect(getAllFlags(["--label", "bug", "--label"], "--label")).toEqual(["bug"]);
  });
});

describe("getPositional", () => {
  it("returns the first non-flag arg from startIndex", () => {
    expect(getPositional(["view", "ABC-1", "--full"], 0)).toBe("view");
  });
  it("respects startIndex", () => {
    expect(getPositional(["view", "ABC-1", "--full"], 1)).toBe("ABC-1");
  });
  it("returns undefined when all args are flags", () => {
    expect(getPositional(["--full", "--comments"], 0)).toBeUndefined();
  });
  it("returns undefined for empty args", () => {
    expect(getPositional([], 0)).toBeUndefined();
  });
});

describe("requireNumber", () => {
  it("parses a valid number", () => {
    expect(requireNumber("42", "limit")).toBe(42);
  });
  it("parses zero", () => {
    expect(requireNumber("0", "limit")).toBe(0);
  });
  it("throws for undefined input", () => {
    expect(() => requireNumber(undefined, "limit")).toThrow(AxiError);
    expect(() => requireNumber(undefined, "limit")).toThrow("Missing limit number");
  });
  it("throws for a non-numeric string", () => {
    expect(() => requireNumber("abc", "limit")).toThrow("Invalid limit number: abc");
  });
  it("thrown error has VALIDATION_ERROR code", () => {
    try {
      requireNumber("abc", "limit");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("VALIDATION_ERROR");
    }
  });
});

describe("requirePositional", () => {
  it("returns the positional when present", () => {
    expect(requirePositional(["view", "ABC-1"], 1, "issue id")).toBe("ABC-1");
  });
  it("throws VALIDATION_ERROR naming the label when missing", () => {
    try {
      requirePositional(["view", "--full"], 1, "issue id");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AxiError);
      expect((e as AxiError).code).toBe("VALIDATION_ERROR");
      expect((e as AxiError).message).toContain("issue id");
    }
  });
});

describe("rejectUnknownFlags", () => {
  const allowed = ["--state", "--assignee", "--limit"];

  it("passes when every flag is allowed", () => {
    expect(() =>
      rejectUnknownFlags(["--state", "open", "--limit", "10"], "issue list", allowed),
    ).not.toThrow();
  });

  it("passes with no flags at all", () => {
    expect(() => rejectUnknownFlags(["ABC-1"], "issue view", allowed)).not.toThrow();
  });

  it("throws VALIDATION_ERROR listing valid flags for an unknown flag", () => {
    try {
      rejectUnknownFlags(["--bogus"], "issue list", allowed);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AxiError);
      const err = e as AxiError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toContain("Unknown flag --bogus");
      expect(err.message).toContain("issue list");
      expect(err.suggestions.join(" ")).toContain("--state, --assignee, --limit");
      expect(err.suggestions.join(" ")).toContain("--help always allowed");
    }
  });

  it("gives a targeted hint for a known alias", () => {
    try {
      rejectUnknownFlags(["--status", "open"], "issue list", allowed, {
        "--status": "--status was renamed; use --state instead",
      });
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as AxiError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toContain("--status was renamed; use --state instead");
      // Alias hint replaces the generic valid-flag list.
      expect(err.suggestions).toEqual([]);
    }
  });

  it("always allows --help", () => {
    expect(() => rejectUnknownFlags(["--help"], "issue list", allowed)).not.toThrow();
    expect(() => rejectUnknownFlags(["--state", "open", "--help"], "issue list", allowed)).not.toThrow();
  });

  it("rejects an unknown flag in equals form", () => {
    try {
      rejectUnknownFlags(["--bogus=x"], "issue list", allowed);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).message).toContain("Unknown flag --bogus");
    }
  });

  it("accepts an allowed flag in equals form", () => {
    expect(() => rejectUnknownFlags(["--state=open"], "issue list", allowed)).not.toThrow();
  });

  it("skips a space-form flag value that itself starts with --", () => {
    // --assignee consumes the following token as its value, so --weird is not validated.
    expect(() => rejectUnknownFlags(["--assignee", "--weird"], "issue list", allowed)).not.toThrow();
  });

  it("still rejects an unknown flag that follows a consumed value", () => {
    try {
      rejectUnknownFlags(["--state", "open", "--nope"], "issue list", allowed);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).message).toContain("--nope");
    }
  });

  it("ignores positional (non -- prefixed) args", () => {
    expect(() => rejectUnknownFlags(["ABC-1", "--state", "open"], "issue view", allowed)).not.toThrow();
  });

  it("lists (none) when no flags are allowed", () => {
    try {
      rejectUnknownFlags(["--x"], "issue reopen", []);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).suggestions.join(" ")).toContain("(none)");
    }
  });
});

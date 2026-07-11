import { describe, it, expect } from "vitest";
import { toLinearDuration, parseDueDate } from "../src/dates.js";
import { AxiError } from "../src/errors.js";

describe("toLinearDuration", () => {
  it("converts hours", () => {
    expect(toLinearDuration("2h", "--updated-since")).toBe("-PT2H");
  });
  it("converts days", () => {
    expect(toLinearDuration("3d", "--updated-since")).toBe("-P3D");
  });
  it("converts weeks", () => {
    expect(toLinearDuration("2w", "--updated-since")).toBe("-P2W");
  });
  it("converts months", () => {
    expect(toLinearDuration("1m", "--updated-since")).toBe("-P1M");
  });
  it("converts years", () => {
    expect(toLinearDuration("1y", "--updated-since")).toBe("-P1Y");
  });

  it("tolerates a space between number and unit", () => {
    expect(toLinearDuration("2 w", "--updated-since")).toBe("-P2W");
  });

  it("uppercases the unit letter", () => {
    expect(toLinearDuration("3D", "--updated-since")).toBe("-P3D");
  });

  it("passes through an ISO duration without a leading minus (adding one)", () => {
    expect(toLinearDuration("P2W", "--updated-since")).toBe("-P2W");
  });

  it("passes through an ISO duration with a leading minus", () => {
    expect(toLinearDuration("-P3D", "--updated-since")).toBe("-P3D");
  });

  it("uppercases a lowercase ISO duration", () => {
    expect(toLinearDuration("-p2w", "--updated-since")).toBe("-P2W");
  });

  it("passes through an absolute ISO date unchanged", () => {
    expect(toLinearDuration("2026-01-15", "--updated-since")).toBe("2026-01-15");
  });

  it("passes through an absolute ISO datetime unchanged", () => {
    expect(toLinearDuration("2026-01-15T10:00:00Z", "--updated-since")).toBe("2026-01-15T10:00:00Z");
  });

  it("throws VALIDATION_ERROR for garbage, naming the flag", () => {
    try {
      toLinearDuration("soon", "--updated-since");
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AxiError);
      expect((e as AxiError).code).toBe("VALIDATION_ERROR");
      expect((e as AxiError).message).toContain("--updated-since");
    }
  });

  it("throws for an unsupported unit", () => {
    expect(() => toLinearDuration("5s", "--updated-since")).toThrow(AxiError);
  });
});

describe("parseDueDate", () => {
  it("accepts a YYYY-MM-DD date", () => {
    expect(parseDueDate("2026-07-11")).toBe("2026-07-11");
  });

  it("trims surrounding whitespace", () => {
    expect(parseDueDate("  2026-07-11  ")).toBe("2026-07-11");
  });

  it("rejects a non-ISO date, naming the default flag", () => {
    try {
      parseDueDate("07/11/2026");
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as AxiError).code).toBe("VALIDATION_ERROR");
      expect((e as AxiError).message).toContain("--due");
    }
  });

  it("rejects a datetime string", () => {
    expect(() => parseDueDate("2026-07-11T00:00:00Z")).toThrow(AxiError);
  });

  it("uses a custom flag name in the error", () => {
    expect(() => parseDueDate("bad", "--start")).toThrow("--start");
  });
});

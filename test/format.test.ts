import { describe, it, expect } from "vitest";
import { formatCountLine } from "../src/format.js";

describe("formatCountLine", () => {
  it("returns a simple count when nothing else applies", () => {
    expect(formatCountLine({ count: 5 })).toBe("count: 5");
  });

  it("returns count with total when totalCount is provided", () => {
    expect(formatCountLine({ count: 30, totalCount: 150 })).toBe("count: 30 of 150 total");
  });

  it("prefers totalCount over hasMore", () => {
    expect(formatCountLine({ count: 5, totalCount: 12, hasMore: true })).toBe("count: 5 of 12 total");
  });

  it("prefers totalCount over a limit-hit", () => {
    expect(formatCountLine({ count: 30, limit: 30, totalCount: 200 })).toBe("count: 30 of 200 total");
  });

  it("renders totalCount of 0", () => {
    expect(formatCountLine({ count: 0, totalCount: 0 })).toBe("count: 0 of 0 total");
  });

  it("renders (more available) when a connection has a next page", () => {
    expect(formatCountLine({ count: 25, hasMore: true })).toBe("count: 25 (more available)");
  });

  it("renders (showing first N) when displayLimit truncates results", () => {
    expect(formatCountLine({ count: 50, displayLimit: 30 })).toBe("count: 50 (showing first 30)");
  });

  it("ignores displayLimit that is not exceeded", () => {
    expect(formatCountLine({ count: 20, displayLimit: 30 })).toBe("count: 20");
  });

  it("renders (showing first N) when count equals the request limit", () => {
    expect(formatCountLine({ count: 30, limit: 30 })).toBe("count: 30 (showing first 30)");
  });

  it("returns a simple count when count is below the limit", () => {
    expect(formatCountLine({ count: 5, limit: 30 })).toBe("count: 5");
  });

  it("does not treat a zero-count limit as a limit-hit", () => {
    expect(formatCountLine({ count: 0, limit: 0 })).toBe("count: 0");
    expect(formatCountLine({ count: 0, limit: 30 })).toBe("count: 0");
  });

  it("handles a plain zero count", () => {
    expect(formatCountLine({ count: 0 })).toBe("count: 0");
  });
});

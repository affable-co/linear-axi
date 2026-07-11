import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { cleanBody, takeBody, truncateBody } from "../src/body.js";
import { AxiError } from "../src/errors.js";

function withTempDir<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "linear-axi-body-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("takeBody", () => {
  it("returns inline body text and removes the flag", () => {
    const args = ["--body", "hello", "--label", "bug"];
    expect(takeBody(args)).toBe("hello");
    expect(args).toEqual(["--label", "bug"]);
  });

  it("preserves dash-leading inline markdown", () => {
    const args = ["--body", "- one\n- two"];
    expect(takeBody(args)).toBe("- one\n- two");
    expect(args).toEqual([]);
  });

  it("reads UTF-8 body text from a real file and removes the flag", () =>
    withTempDir((dir) => {
      const file = join(dir, "body.md");
      const body = "line 1\n```ts\nconst ok = true;\n```\nIt's fine.\n";
      writeFileSync(file, body, "utf8");
      const args = ["--body-file", file, "--label", "bug"];
      expect(takeBody(args)).toBe(body);
      expect(args).toEqual(["--label", "bug"]);
    }));

  it("supports equals-form --body-file", () =>
    withTempDir((dir) => {
      const file = join(dir, "body.md");
      writeFileSync(file, "from equals", "utf8");
      expect(takeBody([`--body-file=${file}`])).toBe("from equals");
    }));

  it("returns undefined when optional and omitted", () => {
    expect(takeBody(["--label", "bug"])).toBeUndefined();
  });

  it("requires exactly one source when required", () => {
    expect(() => takeBody([], { required: true })).toThrow(AxiError);
    expect(() => takeBody([], { required: true })).toThrow("--body or --body-file is required");
  });

  it("rejects --body and --body-file together", () =>
    withTempDir((dir) => {
      const file = join(dir, "body.md");
      writeFileSync(file, "file body", "utf8");
      expect(() => takeBody(["--body", "inline", "--body-file", file])).toThrow(/Use only one body source/);
    }));

  it("does not consume another body flag as inline text", () =>
    withTempDir((dir) => {
      const file = join(dir, "body.md");
      writeFileSync(file, "file body", "utf8");
      expect(() => takeBody(["--body", "--body-file", file])).toThrow(/Use only one body source/);
    }));

  it("treats a configured value boundary flag as a missing body value", () => {
    expect(() =>
      takeBody(["--body", "--reply-to", "c1"], { valueBoundaryFlags: ["--reply-to"] }),
    ).toThrow("--body requires text");
  });

  it("rejects --body-file without a path", () => {
    expect(() => takeBody(["--body-file"])).toThrow("--body-file requires path");
  });

  it("reports a missing --body-file path clearly", () =>
    withTempDir((dir) => {
      const missing = join(dir, "nope.md");
      expect(() => takeBody(["--body-file", missing])).toThrow("--body-file path not found");
      expect(() => takeBody(["--body-file", missing])).toThrow(missing);
    }));

  it("reports a directory path as unreadable", () =>
    withTempDir((dir) => {
      expect(() => takeBody(["--body-file", dir])).toThrow(
        "--body-file must point to a readable UTF-8 file",
      );
    }));
});

describe("cleanBody (Linear-specific rules)", () => {
  it("normalizes a Linear issue markdown link to a bare identifier", () => {
    const input = "[Fix bug](https://linear.app/acme/issue/ENG-42/fix-the-bug)";
    expect(cleanBody(input)).toBe("[Fix bug](ENG-42)");
  });

  it("normalizes a Linear issue markdown link without a slug", () => {
    const input = "[Fix bug](https://linear.app/acme/issue/ENG-42)";
    expect(cleanBody(input)).toBe("[Fix bug](ENG-42)");
  });

  it("normalizes a bare Linear issue URL to its identifier", () => {
    const input = "See https://linear.app/acme/issue/ENG-42 for details";
    expect(cleanBody(input)).toBe("See ENG-42 for details");
  });

  it("normalizes a bare Linear issue URL that carries a slug", () => {
    const input = "Related to https://linear.app/acme/issue/ENG-42/fix-the-bug now";
    expect(cleanBody(input)).toBe("Related to ENG-42 now");
  });

  it("strips a markdown image embed with alt text", () => {
    expect(cleanBody("![screenshot](https://example.com/img.png)")).toBe("[image: screenshot]");
  });

  it("strips a markdown image embed without alt text", () => {
    expect(cleanBody("![](https://example.com/img.png)")).toBe("[image]");
  });

  it("strips long URLs (>80 chars) in markdown links", () => {
    const longUrl = "https://example.com/" + "a".repeat(80);
    expect(cleanBody(`[click here](${longUrl})`)).toBe("[click here]");
  });

  it("preserves short URLs in markdown links", () => {
    const shortUrl = "https://example.com/short";
    expect(cleanBody(`[click here](${shortUrl})`)).toBe(`[click here](${shortUrl})`);
  });

  it("strips standalone long URLs (>100 chars)", () => {
    const longUrl = "https://example.com/" + "a".repeat(100);
    expect(cleanBody(`Check ${longUrl} for info`)).toBe("Check [long URL removed] for info");
  });

  it("collapses quoted blocks of 3+ lines", () => {
    const input = "> l1\n> l2\n> l3\n> l4";
    expect(cleanBody(input)).toContain("[quoted text removed]");
  });

  it("does not collapse fewer than 3 quoted lines", () => {
    const input = "> l1\n> l2\nplain";
    expect(cleanBody(input)).toContain("> l1");
    expect(cleanBody(input)).toContain("> l2");
  });

  it("passes plain text through unchanged", () => {
    const input = "A simple body with no special content.";
    expect(cleanBody(input)).toBe(input);
  });
});

describe("truncateBody", () => {
  it("returns short strings raw", () => {
    expect(truncateBody("short text", 500)).toBe("short text");
  });

  it("returns strings exactly at maxLen raw", () => {
    const text = "x".repeat(500);
    expect(truncateBody(text, 500)).toBe(text);
  });

  it("returns empty string for non-string input", () => {
    expect(truncateBody(null)).toBe("");
    expect(truncateBody(undefined)).toBe("");
    expect(truncateBody(123 as unknown)).toBe("");
  });

  it("returns empty string for an empty string", () => {
    expect(truncateBody("")).toBe("");
  });

  it("adds a cleaned note when cleaning brings it under maxLen", () => {
    const longUrl = "https://example.com/" + "a".repeat(100);
    const body = "Check " + longUrl;
    const result = truncateBody(body, 100);
    expect(result).toContain("(cleaned, ");
    expect(result).toContain("chars original");
    expect(result).toContain("use --full to see original");
  });

  it("honors a custom originalHint on the cleaned note", () => {
    const longUrl = "https://example.com/" + "a".repeat(100);
    const body = "Check " + longUrl;
    const result = truncateBody(body, 100, { originalHint: "run issue view --full" });
    expect(result).toContain("run issue view --full");
  });

  it("adds a truncated note when still too long after cleaning", () => {
    const text = "x".repeat(600);
    const result = truncateBody(text, 500);
    expect(result).toContain("... (truncated, 600 chars total");
    expect(result).toContain("use --full to see complete body)");
    expect(result.length).toBeLessThan(600);
  });

  it("honors a custom fullHint on the truncated note", () => {
    const text = "x".repeat(600);
    const result = truncateBody(text, 500, { fullHint: "see full thread with `issue comments`" });
    expect(result).toContain("see full thread with `issue comments`");
  });

  it("uses a default maxLen of 500", () => {
    expect(truncateBody("x".repeat(501))).toContain("truncated");
  });
});

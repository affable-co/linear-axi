import { describe, it, expect } from "vitest";
import { parseFields, type ExtraFieldSpec } from "../src/fields.js";
import { field, relativeTime, joinArray, custom } from "../src/toon.js";
import { AxiError } from "../src/errors.js";

const available: Record<string, ExtraFieldSpec> = {
  labels: { selection: "labels { nodes { name } }", def: joinArray("labels", "name", "labels") },
  priority: { selection: "priority", def: field("priority") },
  updated: { selection: "updatedAt", def: relativeTime("updatedAt", "updated") },
  project: { selection: "project { name }", def: custom("project", (i) => i.project?.name ?? "none") },
};

describe("parseFields", () => {
  it("returns empty arrays when fieldsArg is undefined", () => {
    const result = parseFields(undefined, available);
    expect(result.extraDefs).toEqual([]);
    expect(result.extraSelections).toEqual([]);
  });

  it("parses a single field into its def and selection", () => {
    const result = parseFields("labels", available);
    expect(result.extraDefs).toEqual([available.labels.def]);
    expect(result.extraSelections).toEqual(["labels { nodes { name } }"]);
  });

  it("parses multiple comma-separated fields preserving order", () => {
    const result = parseFields("priority,updated", available);
    expect(result.extraDefs).toHaveLength(2);
    expect(result.extraSelections).toEqual(["priority", "updatedAt"]);
  });

  it("trims whitespace around field names", () => {
    const result = parseFields(" priority , updated ", available);
    expect(result.extraSelections).toEqual(["priority", "updatedAt"]);
  });

  it("deduplicates repeated fields", () => {
    const result = parseFields("priority,priority", available);
    expect(result.extraDefs).toHaveLength(1);
    expect(result.extraSelections).toEqual(["priority"]);
  });

  it("ignores empty segments from trailing commas", () => {
    const result = parseFields("priority,", available);
    expect(result.extraDefs).toHaveLength(1);
    expect(result.extraSelections).toEqual(["priority"]);
  });

  it("returns empty arrays for an all-empty input", () => {
    const result = parseFields("  ,  ,", available);
    expect(result.extraDefs).toEqual([]);
    expect(result.extraSelections).toEqual([]);
  });

  it("throws VALIDATION_ERROR listing the available fields sorted", () => {
    try {
      parseFields("priority,bogus", available);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(AxiError);
      const err = e as AxiError;
      expect(err.code).toBe("VALIDATION_ERROR");
      expect(err.message).toContain("bogus");
      // Available names are listed alphabetically sorted.
      expect(err.message).toContain("labels, priority, project, updated");
    }
  });

  it("lists every unknown field", () => {
    try {
      parseFields("bad1,bad2", available);
      expect.fail("should have thrown");
    } catch (e) {
      const err = e as AxiError;
      expect(err.message).toContain("bad1");
      expect(err.message).toContain("bad2");
    }
  });
});

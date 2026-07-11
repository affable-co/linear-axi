import { AxiError } from "./errors.js";
import type { FieldDef } from "./toon.js";

/**
 * Describes an extra field that can be requested via --fields.
 * `selection` is the GraphQL selection snippet to add to the query
 * (e.g. "updatedAt" or "labels { nodes { name } }").
 * `def` is the FieldDef used to extract/format the value.
 */
export interface ExtraFieldSpec {
  selection: string;
  def: FieldDef;
}

export interface ParseFieldsResult {
  extraDefs: FieldDef[];
  extraSelections: string[];
}

/**
 * Parse a --fields value (comma-separated field names), validate against
 * the available map, and return the extra FieldDefs and GraphQL selections.
 *
 * Returns empty arrays when fieldsArg is undefined (no --fields passed).
 * Throws AxiError with VALIDATION_ERROR for any unknown field names.
 */
export function parseFields(
  fieldsArg: string | undefined,
  available: Record<string, ExtraFieldSpec>,
): ParseFieldsResult {
  if (fieldsArg === undefined) {
    return { extraDefs: [], extraSelections: [] };
  }

  const requested = [...new Set(fieldsArg.split(",").map((f) => f.trim()).filter(Boolean))];

  const unknown = requested.filter((f) => !(f in available));
  if (unknown.length > 0) {
    const availableNames = Object.keys(available).sort().join(", ");
    throw new AxiError(
      `Unknown field(s): ${unknown.join(", ")}. Available: ${availableNames}`,
      "VALIDATION_ERROR",
    );
  }

  const extraDefs: FieldDef[] = [];
  const extraSelections: string[] = [];

  for (const name of requested) {
    const spec = available[name];
    extraDefs.push(spec.def);
    extraSelections.push(spec.selection);
  }

  return { extraDefs, extraSelections };
}

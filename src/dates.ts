import { AxiError } from "./errors.js";

/**
 * Convert friendly relative durations to the ISO 8601 negative durations
 * Linear's date comparators accept (e.g. `updatedAt: { gt: "-P2W" }`).
 *
 * Accepts: `2h`, `3d`, `2w`, `1m` (months), `1y`, an existing ISO duration
 * (`-P2W`, `P3D`), or an absolute ISO date (passed through).
 */
export function toLinearDuration(input: string, flagName: string): string {
  const trimmed = input.trim();

  // Already an ISO duration
  if (/^-?P/i.test(trimmed)) {
    return trimmed.startsWith("-") ? trimmed.toUpperCase() : `-${trimmed.toUpperCase()}`;
  }

  // Absolute ISO date/datetime — pass through
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed;
  }

  const match = trimmed.match(/^(\d+)\s*(h|d|w|m|y)$/i);
  if (!match) {
    throw new AxiError(
      `Invalid ${flagName} value: ${input}. Use forms like 2h, 3d, 2w, 1m, 1y, or an ISO date`,
      "VALIDATION_ERROR",
    );
  }
  const n = match[1];
  switch (match[2].toLowerCase()) {
    case "h":
      return `-PT${n}H`;
    case "d":
      return `-P${n}D`;
    case "w":
      return `-P${n}W`;
    case "m":
      return `-P${n}M`;
    case "y":
      return `-P${n}Y`;
    default:
      throw new AxiError(`Invalid ${flagName} unit: ${match[2]}`, "VALIDATION_ERROR");
  }
}

/** Validate an issue due date flag: YYYY-MM-DD only. */
export function parseDueDate(input: string, flagName = "--due"): string {
  const trimmed = input.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new AxiError(`Invalid ${flagName} date: ${input}. Use YYYY-MM-DD`, "VALIDATION_ERROR");
  }
  return trimmed;
}

import { AxiError } from "./errors.js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

/** Get a flag's value from --flag value or --flag=value without modifying args. */
export function getFlag(args: string[], name: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(name);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      if (i + 1 >= args.length) return undefined;
      return args[i + 1];
    }
    if (arg.startsWith(equalsPrefix)) {
      return arg.slice(equalsPrefix.length);
    }
  }
  return undefined;
}

/** Get a flag's value from --flag value or --flag=value and remove it from args. */
export function takeFlag(args: string[], flag: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      args.splice(i, 2);
      return val;
    }
    if (arg.startsWith(equalsPrefix)) {
      const val = arg.slice(equalsPrefix.length);
      args.splice(i, 1);
      return val;
    }
  }
  return undefined;
}

/** Check if a boolean flag is present. */
export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

/** Check if a boolean flag is present and remove it from args. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/** Collect all values for a repeatable flag in --flag value or --flag=value form. */
export function getAllFlags(args: string[], flag: string): string[] {
  const result: string[] = [];
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag && i + 1 < args.length) {
      result.push(args[i + 1]);
      i++;
    } else if (arg.startsWith(equalsPrefix)) {
      result.push(arg.slice(equalsPrefix.length));
    }
  }
  return result;
}

/** Get the first positional arg (non-flag) starting from startIndex. */
export function getPositional(args: string[], startIndex: number): string | undefined {
  for (let i = startIndex; i < args.length; i++) {
    if (!args[i].startsWith("--")) return args[i];
  }
  return undefined;
}

/** Parse and validate a required positional argument. */
export function requirePositional(args: string[], startIndex: number, label: string): string {
  const value = getPositional(args, startIndex);
  if (!value) throw new AxiError(`Missing ${label}`, "VALIDATION_ERROR");
  return value;
}

/** Parse and validate a required numeric flag value. */
export function requireNumber(raw: string | undefined, label: string): number {
  if (!raw) throw new AxiError(`Missing ${label} number`, "VALIDATION_ERROR");
  const n = parseInt(raw, 10);
  if (isNaN(n)) throw new AxiError(`Invalid ${label} number: ${raw}`, "VALIDATION_ERROR");
  return n;
}

/**
 * Renamed/removed flags that get a targeted hint instead of the generic
 * valid-flag list, so an agent self-corrects in one step.
 */
export type FlagAliases = Record<string, string>;

/**
 * AXI principle 6: fail loud on unknown flags. Validates that every `--flag`
 * in args (after positionals) is in the allowed set, throwing a
 * VALIDATION_ERROR (exit 2) that inlines the command's valid flags.
 *
 * Flags whose value was already consumed by takeFlag/takeBody never reach
 * this check; call it FIRST, before consuming, with the full allowed set.
 * `--help` always passes.
 */
export function rejectUnknownFlags(
  args: string[],
  command: string,
  allowed: string[],
  aliases: FlagAliases = {},
): void {
  const allowedSet = new Set([...allowed, "--help"]);
  const valueTaking = new Set(allowed);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (allowedSet.has(name)) {
      // Skip the flag's value in space-separated form so values that start
      // with -- (rare) are not themselves validated.
      if (arg === name && valueTaking.has(name)) i++;
      continue;
    }
    if (name in aliases) {
      throw new AxiError(
        `Unknown flag ${name} for \`${command}\`: ${aliases[name]}`,
        "VALIDATION_ERROR",
      );
    }
    throw new AxiError(
      `Unknown flag ${name} for \`${command}\``,
      "VALIDATION_ERROR",
      [`Valid flags for \`${command}\`: ${allowed.join(", ") || "(none)"} (--help always allowed)`],
    );
  }
}

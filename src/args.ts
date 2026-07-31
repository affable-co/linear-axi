import { AxiError } from "./errors.js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

function isLongFlagToken(value: string): boolean {
  return /^--[A-Za-z0-9][A-Za-z0-9-]*(?:=.*)?$/.test(value);
}

function requireFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (value === undefined || isLongFlagToken(value)) {
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  }
  return value;
}

function requireEqualsValue(arg: string, flag: string): string {
  const value = arg.slice(flagEqualsPrefix(flag).length);
  if (value === "") {
    throw new AxiError(`${flag} requires a value`, "VALIDATION_ERROR");
  }
  return value;
}

/** Get a flag's value from --flag value or --flag=value without modifying args. */
export function getFlag(args: string[], name: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(name);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      return requireFlagValue(args, i, name);
    }
    if (arg.startsWith(equalsPrefix)) {
      return requireEqualsValue(arg, name);
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
      const val = requireFlagValue(args, i, flag);
      args.splice(i, 2);
      return val;
    }
    if (arg.startsWith(equalsPrefix)) {
      const val = requireEqualsValue(arg, flag);
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
    if (arg === flag) {
      result.push(requireFlagValue(args, i, flag));
      i++;
    } else if (arg.startsWith(equalsPrefix)) {
      result.push(requireEqualsValue(arg, flag));
    }
  }
  return result;
}

/** Get the first positional arg, skipping values owned by known value-taking flags. */
export function getPositional(
  args: string[],
  startIndex: number,
  valueTakingFlags: readonly string[] = [],
): string | undefined {
  const valueTaking = new Set(valueTakingFlags);
  for (let i = startIndex; i < args.length; i++) {
    const arg = args[i];
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (valueTaking.has(name) && arg === name) {
      i++;
      continue;
    }
    if (!arg.startsWith("--")) return arg;
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
  const booleanFlags = new Set([
    "--help",
    "--full",
    "--comments",
    "--cancel",
    "--no-branch",
    "--all",
  ]);
  const valueTaking = new Set(allowed.filter((flag) => !booleanFlags.has(flag)));
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (allowedSet.has(name)) {
      if (booleanFlags.has(name) && arg !== name) {
        throw new AxiError(`${name} does not take a value`, "VALIDATION_ERROR");
      }
      if (arg === name && valueTaking.has(name)) {
        requireFlagValue(args, i, name);
        i++;
      } else if (valueTaking.has(name)) {
        requireEqualsValue(arg, name);
      }
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

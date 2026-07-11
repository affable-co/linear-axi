import type { LinearContext } from "../context.js";
import { getFlag, getPositional, rejectUnknownFlags } from "../args.js";
import { AxiError, mapLinearError } from "../errors.js";
import { gqlRaw } from "../linear.js";
import { isStdinTTY, readStdin } from "../stdin.js";

export const API_HELP = `usage: linear-axi api '<graphql>' [--input '<json>']
description: Raw Linear GraphQL escape hatch. Prints compact JSON (no TOON). Query may also be piped on stdin.
flags[1]:
  --input '<json>' (variables object)
examples:
  linear-axi api '{ viewer { id name } }'
  linear-axi api 'query($id:String!){ issue(id:$id){ title } }' --input '{"id":"ABC-123"}'
`;

export async function apiCommand(args: string[], _ctx?: LinearContext): Promise<string> {
  if (args[0] === "--help") return API_HELP;

  rejectUnknownFlags(args, "api", ["--input"]);

  const inputRaw = getFlag(args, "--input");
  let variables: Record<string, unknown> | undefined;
  if (inputRaw !== undefined) {
    try {
      variables = JSON.parse(inputRaw) as Record<string, unknown>;
    } catch (error) {
      const detail = error instanceof Error ? error.message.split("\n")[0] : String(error);
      throw new AxiError(`Invalid --input JSON: ${detail}`, "VALIDATION_ERROR");
    }
  }

  let query = getPositional(args, 0);
  if (!query) {
    // Never hang waiting on an interactive terminal.
    if (isStdinTTY()) {
      throw new AxiError("GraphQL query is required", "VALIDATION_ERROR", [
        `Run \`linear-axi api '{ viewer { id name } }'\``,
        "Or pipe a query on stdin",
      ]);
    }
    query = (await readStdin()).trim();
    if (!query) {
      throw new AxiError("GraphQL query is required (stdin was empty)", "VALIDATION_ERROR", [
        `Run \`linear-axi api '{ viewer { id name } }'\``,
      ]);
    }
  }

  const result = await gqlRaw<Record<string, unknown>>(query, variables);
  if (result.errors?.length || !result.data) {
    throw mapLinearError(result.errors, result.status, result.rateLimitReset);
  }
  // Escape hatch: raw compact JSON — shapes are arbitrary, no TOON conversion.
  return JSON.stringify(result.data);
}

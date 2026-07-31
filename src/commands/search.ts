import type { LinearContext } from "../context.js";
import { getFlag, getPositional, rejectUnknownFlags } from "../args.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import { gqlQuery } from "../linear.js";
import { getSuggestions, shellArg } from "../suggestions.js";
import {
  custom,
  field,
  pluck,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const SEARCH_HELP = `usage: linear-axi search <text> [flags]
description: Full-text search across issues.
flags[1]:
  --limit <n> (default 25)
examples:
  linear-axi search "login bug"
  linear-axi search "rate limit" --limit 50
`;

const resultSchema: FieldDef[] = [
  field("identifier", "id"),
  field("title"),
  pluck("state", "name", "state"),
  pluck("team", "key", "team"),
  custom("assignee", (i) => i.assignee?.displayName ?? "unassigned"),
];

export async function searchCommand(args: string[], ctx?: LinearContext): Promise<string> {
  if (args[0] === "--help") return SEARCH_HELP;

  rejectUnknownFlags(args, "search", ["--limit"]);

  const term = getPositional(args, 0, ["--limit"]);
  if (!term) {
    throw new AxiError("Search text is required", "VALIDATION_ERROR", [
      'Run `linear-axi search "login bug"`',
    ]);
  }

  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 25, 1), 250) : 25;

  const data = await gqlQuery<{
    searchIssues: { nodes: Record<string, unknown>[]; pageInfo: { hasNextPage: boolean } };
  }>(
    `query($term: String!, $first: Int!) {
      searchIssues(term: $term, first: $first) {
        nodes { identifier title state { name } team { key } assignee { displayName } }
        pageInfo { hasNextPage }
      }
    }`,
    { term, first: limit },
  );

  const results = data.searchIssues.nodes;
  const blocks: string[] = [];

  if (results.length === 0) {
    blocks.push(`results: 0 found for "${term}"`);
  } else {
    blocks.push(formatCountLine({ count: results.length, limit, hasMore: data.searchIssues.pageInfo.hasNextPage }));
    blocks.push(renderList("results", results, resultSchema));
  }

  const hints: string[] = [];
  if (results.length > 0 && data.searchIssues.pageInfo.hasNextPage) {
    hints.push(`Run \`linear-axi search ${shellArg(term)} --limit ${Math.min(limit * 2, 250)}\` to see more`);
  }
  blocks.push(
    renderHelp([...hints, ...getSuggestions({ domain: "search", action: "search", isEmpty: results.length === 0, ctx })]),
  );
  return renderOutput(blocks);
}

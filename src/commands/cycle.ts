import type { LinearContext } from "../context.js";
import { getFlag, takeBoolFlag, getPositional, rejectUnknownFlags } from "../args.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import { gqlQuery } from "../linear.js";
import { resolveCycle, resolveTeam, type ResolvedTeam } from "../resolve.js";
import { getSuggestions } from "../suggestions.js";
import {
  boolYesNo,
  custom,
  field,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const CYCLE_HELP = `usage: linear-axi cycle <subcommand> [args] [flags]
subcommands[2]:
  list, view <current|next|previous|number|name>
list flags{2}: --limit <n> (default 12), --all (include past cycles)
notes:
  Both subcommands need a team, from --team <key>, LINEAR_TEAM, .linear.toml, or the git branch.
  Linear generates cycles automatically — there is no create, update, or delete.
examples:
  linear-axi cycle list --team ENG
  linear-axi cycle view current --team ENG
  linear-axi cycle view 42
`;

async function contextTeam(ctx?: LinearContext): Promise<ResolvedTeam | undefined> {
  if (!ctx?.team) return undefined;
  return resolveTeam(ctx.team.team);
}

function isoDay(value: unknown): string {
  return typeof value === "string" && value.length >= 10 ? value.slice(0, 10) : "unknown";
}

function progressPercent(c: { progress?: number }): string {
  return `${Math.round((c.progress ?? 0) * 100)}%`;
}

/** Pre-computed aggregate: the latest value in a Linear count-history array. */
function lastCount(history: unknown): number | undefined {
  return Array.isArray(history) && history.length > 0 ? Number(history[history.length - 1]) : undefined;
}

// ---------------------------------------------------------------------------
// list

const LIST_FLAGS = ["--limit", "--all"];

const listSchema: FieldDef[] = [
  field("number"),
  field("name"),
  custom("starts", (c) => isoDay(c.startsAt)),
  custom("ends", (c) => isoDay(c.endsAt)),
  custom("progress", progressPercent),
  boolYesNo("isActive", "active"),
];

async function listCycles(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "cycle list", LIST_FLAGS);

  const team = await contextTeam(ctx);
  if (!team) {
    throw new AxiError("cycle list needs a team. Pass --team <key>", "VALIDATION_ERROR", [
      "Run `linear-axi team list` to see team keys",
    ]);
  }

  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 12, 1), 250) : 12;
  const all = takeBoolFlag(args, "--all");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- filter tree is dynamic
  const filter: Record<string, any> = { team: { id: { eq: team.id } } };
  // Default view hides finished cycles; --all includes past ones.
  if (!all) filter["endsAt"] = { gte: new Date().toISOString() };

  const data = await gqlQuery<{
    cycles: { nodes: Record<string, unknown>[]; pageInfo: { hasNextPage: boolean } };
  }>(
    `query($filter: CycleFilter, $first: Int!) {
      cycles(filter: $filter, first: $first) {
        nodes { number name startsAt endsAt progress isActive }
        pageInfo { hasNextPage }
      }
    }`,
    { filter, first: limit },
  );

  const cycles = data.cycles.nodes;
  const blocks: string[] = [];

  if (cycles.length === 0) {
    const scope = all ? "" : " (upcoming; pass --all to include past cycles)";
    blocks.push(`cycles: 0 found for team ${team.key}${scope}`);
  } else {
    blocks.push(formatCountLine({ count: cycles.length, limit, hasMore: data.cycles.pageInfo.hasNextPage }));
    blocks.push(`scope: team ${team.key}`);
    blocks.push(renderList("cycles", cycles, listSchema));
  }

  blocks.push(renderHelp(getSuggestions({ domain: "cycle", action: "list", ctx })));
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// view

async function viewCycle(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "cycle view", []);
  const ref = getPositional(args, 1);
  if (!ref) {
    throw new AxiError("Missing cycle reference", "VALIDATION_ERROR", [
      "Pass current, next, previous, a number, or a name",
    ]);
  }

  const team = await contextTeam(ctx);
  if (!team) {
    throw new AxiError("cycle view needs a team. Pass --team <key>", "VALIDATION_ERROR", [
      "Run `linear-axi team list` to see team keys",
    ]);
  }

  const resolved = await resolveCycle(ref, team);
  const data = await gqlQuery<{ cycle: Record<string, unknown> | null }>(
    `query($id: String!) { cycle(id: $id) {
      id number name startsAt endsAt progress
      issueCountHistory completedIssueCountHistory
    } }`,
    { id: resolved.id },
  );
  if (!data.cycle) {
    throw new AxiError(`Cycle ${ref} not found for team ${team.key}`, "NOT_FOUND", [
      `Run \`linear-axi cycle list --team ${team.key}\` to see cycles`,
    ]);
  }
  const cycle = data.cycle;

  const schema: FieldDef[] = [
    field("number"),
    field("name"),
    custom("starts", (c) => isoDay(c.startsAt)),
    custom("ends", (c) => isoDay(c.endsAt)),
    custom("progress", progressPercent),
  ];
  // Pre-computed aggregates only when Linear returned a count history.
  const issues = lastCount(cycle["issueCountHistory"]);
  if (issues !== undefined) schema.push(custom("issues", () => issues));
  const completed = lastCount(cycle["completedIssueCountHistory"]);
  if (completed !== undefined) schema.push(custom("completed", () => completed));

  return renderOutput([
    renderDetail("cycle", cycle, schema),
    renderHelp(getSuggestions({ domain: "cycle", action: "view", id: ref, ctx })),
  ]);
}

// ---------------------------------------------------------------------------
// dispatcher

export async function cycleCommand(args: string[], ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return CYCLE_HELP;

  switch (sub) {
    case "list":
      return listCycles(args, ctx);
    case "view":
      return viewCycle(args, ctx);
    default:
      return renderError(`Unknown cycle subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi cycle --help` for usage",
      ]);
  }
}

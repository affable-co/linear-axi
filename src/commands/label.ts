import type { LinearContext } from "../context.js";
import { getFlag, takeFlag, rejectUnknownFlags } from "../args.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import { gqlQuery } from "../linear.js";
import { resolveTeam, type ResolvedTeam } from "../resolve.js";
import { getSuggestions } from "../suggestions.js";
import {
  custom,
  field,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const LABEL_HELP = `usage: linear-axi label <subcommand> [args] [flags]
subcommands[2]:
  list, create
list flags{2}: --limit <n> (default 100), --query <text> (name contains)
create flags{3}: --name <text> (required), --color <#hex>, --description <text>
notes:
  With a team (--team / env / .linear.toml / branch), list and create scope to
  that team plus workspace labels; without one they act on all/workspace labels.
examples:
  linear-axi label list
  linear-axi label list --team ENG --query bug
  linear-axi label create --team ENG --name "priority:high" --color "#ff0000"
`;

// ---------------------------------------------------------------------------
// list

const LIST_FLAGS = ["--limit", "--query"];

const listSchema: FieldDef[] = [
  field("name"),
  custom("scope", (l) => l.team?.key ?? "workspace"),
  custom("group", (l) => l.parent?.name ?? "none"),
];

interface LabelNode {
  name: string;
  team: { key: string } | null;
  parent: { name: string } | null;
}

async function listLabels(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "label list", LIST_FLAGS);

  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 100, 1), 250) : 100;
  const query = getFlag(args, "--query");

  const team = ctx?.team ? await resolveTeam(ctx.team.team) : undefined;
  const scopeParts: string[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- filter tree is dynamic
  const conditions: Record<string, any>[] = [];
  if (team) {
    // Team-scoped plus workspace-wide labels.
    conditions.push({ or: [{ team: { id: { eq: team.id } } }, { team: { null: true } }] });
    scopeParts.push(`team: ${team.key} + workspace`);
  }
  if (query) {
    conditions.push({ name: { containsIgnoreCase: query } });
    scopeParts.push(`query: ${query}`);
  }
  const filter =
    conditions.length === 0 ? undefined : conditions.length === 1 ? conditions[0] : { and: conditions };

  const data = await gqlQuery<{
    issueLabels: { nodes: LabelNode[]; pageInfo: { hasNextPage: boolean } };
  }>(
    `query($filter: IssueLabelFilter, $first: Int!) {
      issueLabels(filter: $filter, first: $first) {
        nodes { name team { key } parent { name } }
        pageInfo { hasNextPage }
      }
    }`,
    { filter: filter ?? null, first: limit },
  );

  const labels = data.issueLabels.nodes;
  const blocks: string[] = [];
  if (labels.length === 0) {
    const scope = scopeParts.length ? ` matching ${scopeParts.join(", ")}` : "";
    blocks.push(`labels: 0 found${scope}`);
  } else {
    blocks.push(formatCountLine({ count: labels.length, limit, hasMore: data.issueLabels.pageInfo.hasNextPage }));
    if (scopeParts.length) blocks.push(`scope: ${scopeParts.join(", ")}`);
    blocks.push(renderList("labels", labels, listSchema));
  }

  const hints: string[] = [];
  if (data.issueLabels.pageInfo.hasNextPage) {
    hints.push(`Run \`linear-axi label list --limit ${Math.min(limit * 2, 250)}\` to see more`);
  }
  blocks.push(
    renderHelp([...hints, ...getSuggestions({ domain: "label", action: "list", isEmpty: labels.length === 0, ctx })]),
  );
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// create

const CREATE_FLAGS = ["--name", "--color", "--description"];

async function createLabel(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "label create", CREATE_FLAGS);

  const name = takeFlag(args, "--name");
  if (!name) {
    throw new AxiError("--name is required for label create", "VALIDATION_ERROR", [
      'Run `linear-axi label create --name "..." [--team <key>] [--color "#hex"]`',
    ]);
  }
  const color = takeFlag(args, "--color");
  const description = takeFlag(args, "--description");

  const team: ResolvedTeam | undefined = ctx?.team ? await resolveTeam(ctx.team.team) : undefined;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mutation input is dynamic
  const input: Record<string, any> = { name };
  if (team) input["teamId"] = team.id;
  if (color) input["color"] = color;
  if (description) input["description"] = description;

  const data = await gqlQuery<{
    issueLabelCreate: { success: boolean; issueLabel: { id: string; name: string } };
  }>(
    `mutation($input: IssueLabelCreateInput!) {
      issueLabelCreate(input: $input) {
        success
        issueLabel { id name }
      }
    }`,
    { input },
  );

  const label = data.issueLabelCreate.issueLabel;
  const blocks = [
    renderDetail("label", { ...label, scope: team?.key ?? "workspace" }, [
      field("name"),
      field("scope"),
    ]),
    renderHelp(getSuggestions({ domain: "label", action: "create", ctx })),
  ];
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// dispatcher

export async function labelCommand(args: string[], ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return LABEL_HELP;

  switch (sub) {
    case "list":
      return listLabels(args, ctx);
    case "create":
      return createLabel(args, ctx);
    default:
      return renderError(`Unknown label subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi label --help` for usage",
      ]);
  }
}

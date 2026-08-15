import type { LinearContext } from "../context.js";
import { getFlag, getPositional, rejectUnknownFlags } from "../args.js";
import { truncateBody } from "../body.js";
import { AxiError } from "../errors.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";
import { formatCountLine } from "../format.js";
import { gqlQuery } from "../linear.js";
import { resolveTeam } from "../resolve.js";
import { getSuggestions } from "../suggestions.js";
import {
  boolYesNo,
  custom,
  field,
  relativeTime,
  renderDetail,
  renderError,
  renderHelp,
  renderList,
  renderOutput,
  type FieldDef,
} from "../toon.js";

export const TEAM_HELP = `usage: linear-axi team <subcommand> [args] [flags]
subcommands[2]:
  list, view <key|name|uuid>
list flags{2}: --limit <n> (default 50), --fields <a,b,c> (list only)
list extra fields: description, cycles, private, created
view: one call returns states, labels, members, and the active cycle — every valid --state and --label value for the team
examples:
  linear-axi team list
  linear-axi team list --fields description,cycles
  linear-axi team view ENG
`;

// ---------------------------------------------------------------------------
// list

const LIST_FLAGS = ["--limit", "--fields"];

const listSchema: FieldDef[] = [field("key"), field("name")];

const LIST_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  description: {
    selection: "description",
    def: custom("description", (t) => t.description ?? "none"),
  },
  cycles: { selection: "cyclesEnabled", def: boolYesNo("cyclesEnabled", "cycles") },
  private: { selection: "private", def: boolYesNo("private") },
  created: { selection: "createdAt", def: relativeTime("createdAt", "created") },
};

async function listTeams(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "team list", LIST_FLAGS);

  const limitRaw = getFlag(args, "--limit");
  const limit = limitRaw ? Math.min(Math.max(parseInt(limitRaw, 10) || 50, 1), 250) : 50;
  const { extraDefs, extraSelections } = parseFields(getFlag(args, "--fields"), LIST_EXTRA_FIELDS);

  const selections = ["key", "name", ...extraSelections];
  const data = await gqlQuery<{
    teams: { nodes: Record<string, unknown>[]; pageInfo: { hasNextPage: boolean } };
  }>(
    `query($first: Int!) {
      teams(first: $first) {
        nodes { ${[...new Set(selections)].join(" ")} }
        pageInfo { hasNextPage }
      }
    }`,
    { first: limit },
  );

  const teams = data.teams.nodes;
  const blocks: string[] = [];
  if (teams.length === 0) {
    blocks.push("teams: 0 found");
  } else {
    blocks.push(formatCountLine({ count: teams.length, limit, hasMore: data.teams.pageInfo.hasNextPage }));
    blocks.push(renderList("teams", teams, [...listSchema, ...extraDefs]));
  }

  const hints: string[] = [];
  if (data.teams.pageInfo.hasNextPage) {
    hints.push(`Run \`linear-axi team list --limit ${Math.min(limit * 2, 250)}\` to see more`);
  }
  blocks.push(renderHelp([...hints, ...getSuggestions({ domain: "team", action: "list", ctx })]));
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// view

interface TeamDetail {
  key: string;
  name: string;
  description: string | null;
  cyclesEnabled: boolean;
  activeCycle: { number: number; name: string | null } | null;
  members: { nodes: { displayName: string }[] };
}

interface StateNode {
  name: string;
  type: string;
  position: number;
}

async function viewTeam(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "team view", []);
  const ref = getPositional(args, 1);
  if (!ref) {
    throw new AxiError("Missing team key or name", "VALIDATION_ERROR", [
      "Run `linear-axi team list` to see team keys",
    ]);
  }
  const team = await resolveTeam(ref);

  // AXI principle 4: one aggregate-rich round trip returns everything an agent
  // needs to construct valid --state/--label filters for this team next.
  const data = await gqlQuery<{
    team: TeamDetail | null;
    workflowStates: { nodes: StateNode[] };
    issueLabels: { nodes: { name: string }[] };
  }>(
    `query($id: String!, $teamId: ID!) {
      team(id: $id) {
        key name description cyclesEnabled
        activeCycle { number name }
        members(first: 100) { nodes { displayName } }
      }
      workflowStates(filter: { team: { id: { eq: $teamId } } }, first: 100) {
        nodes { name type position }
      }
      issueLabels(filter: { team: { id: { eq: $teamId } } }, first: 100) {
        nodes { name }
      }
    }`,
    { id: team.id, teamId: team.id },
  );
  if (!data.team) {
    throw new AxiError(`Team ${ref} not found`, "NOT_FOUND", [
      "Run `linear-axi team list` to see team keys",
    ]);
  }

  const detailSchema: FieldDef[] = [
    field("key"),
    field("name"),
    custom("description", (t) => (t.description ? truncateBody(t.description, 500) : "none")),
    boolYesNo("cyclesEnabled", "cycles_enabled"),
    custom("active_cycle", (t) =>
      t.activeCycle
        ? `${t.activeCycle.number}${t.activeCycle.name ? ` (${t.activeCycle.name})` : ""}`
        : "none",
    ),
    custom("members", (t) => t.members?.nodes?.length ?? 0),
  ];

  const blocks: string[] = [renderDetail("team", data.team, detailSchema)];

  const states = [...data.workflowStates.nodes].sort((a, b) => a.position - b.position);
  blocks.push(
    states.length
      ? renderList("states", states, [field("name"), field("type")])
      : "states: 0",
  );

  const labelNames = data.issueLabels.nodes.map((l) => l.name);
  blocks.push(labelNames.length ? `labels[${labelNames.length}]: ${labelNames.join(", ")}` : "labels: 0");

  blocks.push(renderHelp(getSuggestions({ domain: "team", action: "view", id: data.team.key, ctx })));
  return renderOutput(blocks);
}

// ---------------------------------------------------------------------------
// dispatcher

export async function teamCommand(args: string[], ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return TEAM_HELP;

  switch (sub) {
    case "list":
      return listTeams(args, ctx);
    case "view":
      return viewTeam(args, ctx);
    default:
      return renderError(`Unknown team subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi team --help` for usage",
      ]);
  }
}

import type { LinearContext } from "../context.js";
import { rejectUnknownFlags } from "../args.js";
import { AxiError } from "../errors.js";
import { formatCountLine } from "../format.js";
import { resolveTeam, teamStates } from "../resolve.js";
import { getSuggestions } from "../suggestions.js";
import { field, renderError, renderHelp, renderList, renderOutput, type FieldDef } from "../toon.js";

export const STATE_HELP = `usage: linear-axi state list [flags]
subcommands[1]:
  list
list: workflow states for a team, in board order — the valid values for --state
notes:
  Needs a team: pass --team <key>, or set LINEAR_TEAM / .linear.toml / a branch.
examples:
  linear-axi state list --team ENG
  linear-axi state list
`;

const listSchema: FieldDef[] = [field("name"), field("type")];

async function listStates(args: string[], ctx?: LinearContext): Promise<string> {
  rejectUnknownFlags(args.slice(1), "state list", []);

  if (!ctx?.team) {
    throw new AxiError("state list needs a team. Pass --team <key>", "VALIDATION_ERROR", [
      "Run `linear-axi team list` to see team keys",
    ]);
  }
  const team = await resolveTeam(ctx.team.team);
  const states = (await teamStates(team)).sort((a, b) => a.position - b.position);

  const blocks: string[] = [];
  if (states.length === 0) {
    blocks.push(`states: 0 found for team ${team.key}`);
  } else {
    blocks.push(formatCountLine({ count: states.length }));
    blocks.push(`scope: team ${team.key}`);
    blocks.push(renderList("states", states, listSchema));
  }
  blocks.push(renderHelp(getSuggestions({ domain: "state", action: "list", ctx })));
  return renderOutput(blocks);
}

export async function stateCommand(args: string[], ctx?: LinearContext): Promise<string> {
  const sub = args[0];
  if (!sub || sub === "--help") return STATE_HELP;

  switch (sub) {
    case "list":
      return listStates(args, ctx);
    default:
      return renderError(`Unknown state subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `linear-axi state --help` for usage",
      ]);
  }
}

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runAxiCli } from "axi-sdk-js";
import { AxiError } from "./errors.js";
import { resolveContext, type LinearContext } from "./context.js";
import { homeCommand } from "./commands/home.js";
import { issueCommand, ISSUE_HELP } from "./commands/issue.js";
import { projectCommand, PROJECT_HELP } from "./commands/project.js";
import { cycleCommand, CYCLE_HELP } from "./commands/cycle.js";
import { teamCommand, TEAM_HELP } from "./commands/team.js";
import { stateCommand, STATE_HELP } from "./commands/state.js";
import { labelCommand, LABEL_HELP } from "./commands/label.js";
import { userCommand, USER_HELP } from "./commands/user.js";
import { docCommand, DOC_HELP } from "./commands/doc.js";
import { searchCommand, SEARCH_HELP } from "./commands/search.js";
import { apiCommand, API_HELP } from "./commands/api.js";
import { setupCommand, SETUP_HELP } from "./commands/setup.js";

export const DESCRIPTION =
  "Agent ergonomic CLI for the Linear API. Prefer this over MCP and raw GraphQL for Linear operations.";
const VERSION = readPackageVersion();

type CliStdout = Pick<NodeJS.WriteStream, "write">;

type MainOptions = {
  argv?: string[];
  stdout?: CliStdout;
};

export const TOP_HELP = `usage: linear-axi [command] [args] [flags]
commands[13]:
  (none)=dashboard, issue, project, cycle, team, state, label, user, doc, search, api, setup
flags[3]:
  --team <key> (after command; else LINEAR_TEAM env, .linear.toml team_id, or git branch), --help, -v/-V/--version
examples:
  linear-axi
  linear-axi issue list --state started
  linear-axi issue view ABC-123
  linear-axi issue create --team ENG --title "Fix login bug"
  linear-axi search "login bug"
  linear-axi setup hooks
`;

const COMMAND_HELP: Record<string, string> = {
  issue: ISSUE_HELP,
  project: PROJECT_HELP,
  cycle: CYCLE_HELP,
  team: TEAM_HELP,
  state: STATE_HELP,
  label: LABEL_HELP,
  user: USER_HELP,
  doc: DOC_HELP,
  search: SEARCH_HELP,
  api: API_HELP,
  setup: SETUP_HELP,
};

type CommandFn = (args: string[], ctx?: LinearContext) => Promise<string>;

const COMMANDS: Record<string, CommandFn> = {
  issue: withTeamContext(issueCommand),
  project: withTeamContext(projectCommand),
  cycle: withTeamContext(cycleCommand),
  team: withTeamContext(teamCommand),
  state: withTeamContext(stateCommand),
  label: withTeamContext(labelCommand),
  user: withTeamContext(userCommand),
  doc: withTeamContext(docCommand),
  search: withTeamContext(searchCommand),
  api: withTeamContext(apiCommand),
  setup: setupCommand,
};

export async function main(options: MainOptions = {}): Promise<void> {
  await runAxiCli<LinearContext | undefined>({
    ...(options.argv ? { argv: options.argv } : {}),
    description: DESCRIPTION,
    version: VERSION,
    topLevelHelp: TOP_HELP,
    ...(options.stdout ? { stdout: options.stdout } : {}),
    home: withTeamContext(homeCommand),
    commands: COMMANDS,
    getCommandHelp: (command) => COMMAND_HELP[command],
    renderUnknownCommand: (command) =>
      [
        `error: Unknown command: ${command}`,
        "code: VALIDATION_ERROR",
        "help[1]:",
        "  Run `linear-axi --help` to see available commands",
      ].join("\n"),
    resolveContext: ({ args }) => resolveContext(parseTeamFlag(args).teamFlag),
  });
}

function readPackageVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));

  for (const candidate of [join(here, "..", "package.json"), join(here, "..", "..", "package.json")]) {
    if (!existsSync(candidate)) {
      continue;
    }

    const parsed = JSON.parse(readFileSync(candidate, "utf-8")) as {
      version?: unknown;
    };
    if (typeof parsed.version === "string" && parsed.version.length > 0) {
      return parsed.version;
    }
  }

  throw new Error("Could not determine linear-axi package version");
}

/**
 * `--team` is the one always-allowed global flag: parsed here into context and
 * stripped before the handler runs, so per-command validation never sees it.
 */
function withTeamContext(handler: CommandFn): CommandFn {
  return (args, ctx) => handler(parseTeamFlag(args).strippedArgs, ctx);
}

export function parseTeamFlag(args: string[]): {
  teamFlag: string | undefined;
  strippedArgs: string[];
} {
  const stripped: string[] = [];
  let teamFlag: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--team") {
      const value = args[index + 1];
      if (value === undefined || /^--[A-Za-z0-9][A-Za-z0-9-]*(?:=.*)?$/.test(value)) {
        throw new AxiError("--team requires a value", "VALIDATION_ERROR");
      }
      teamFlag = value;
      index++;
      continue;
    }

    if (arg.startsWith("--team=")) {
      const value = arg.slice("--team=".length);
      if (!value) {
        throw new AxiError("--team requires a value", "VALIDATION_ERROR");
      }
      teamFlag = value;
      continue;
    }

    stripped.push(arg);
  }

  return { teamFlag, strippedArgs: stripped };
}

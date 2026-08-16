import { DESCRIPTION, TOP_HELP } from "./cli.js";

const NPX_COMMAND = "npx -y @affable-co/linear-axi";

// Trigger string agents match against to auto-load the skill.
// Kept terse and outcome-focused so it fires on "needs Linear" intents.
export const SKILL_DESCRIPTION =
  "Operate Linear through the linear-axi CLI - issues, projects, cycles, teams, workflow states, " +
  "labels, users, documents, search, authentication checks, and raw GraphQL access. " +
  "Use whenever a task touches Linear: listing, filing, or updating issues, commenting, moving issues " +
  "through workflow states, starting work on an issue (git branch), checking cycles or project progress, " +
  "or searching the workspace.";

function yamlDoubleQuote(value: string): string {
  return JSON.stringify(value);
}

/**
 * Extract the `commands[N]:` block from the top-level help so the skill's
 * command list can never drift from what `linear-axi --help` prints.
 */
export function extractCommandsBlock(): string {
  const match = TOP_HELP.match(/^(commands\[\d+\]:\n(?: {2}.*\n)+)/m);
  if (!match) {
    throw new Error("Could not find commands block in TOP_HELP");
  }
  return match[1].trimEnd();
}

/**
 * Render the installable SKILL.md for the linear-axi skill. The body is built
 * from the same shared guidance the CLI prints (description and top-level
 * help), rewriting invocations to the scoped, non-interactive npm package
 * so the CLI comes along on demand.
 *
 * @returns full SKILL.md contents including YAML frontmatter
 */
export function createSkillMarkdown(): string {
  return `---
name: linear-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
---

# linear-axi

${DESCRIPTION}

You do not need linear-axi installed globally - invoke it with \`${NPX_COMMAND} <command>\`.
If linear-axi output shows a follow-up command starting with \`linear-axi\`, run it as \`${NPX_COMMAND} ...\` instead.

linear-axi requires a Linear API key in the \`LINEAR_API_KEY\` environment variable (create one at https://linear.app/settings/account/security). Keys stored by schpet/linear-cli in \`~/.config/linear/credentials.toml\` are detected automatically. Run \`${NPX_COMMAND} auth status\` to verify authentication; do not guess or invent other login commands. If it fails with \`AUTH_REQUIRED\`, ask the user to set \`LINEAR_API_KEY\` themselves.

## Workflow

1. Run \`${NPX_COMMAND} auth status\` when authentication is unknown or needs verification.
2. Run \`${NPX_COMMAND}\` with no arguments for a dashboard - your active issues and suggested next commands.
3. Drill in command-first: \`issue list\`, \`issue view ABC-123\`, \`project view <name>\`, \`cycle view current --team <key>\`, and so on.
4. Issues accept identifiers everywhere (\`ABC-123\`, case-insensitive); teams accept keys or names; states, labels, projects, and cycles accept names; assignees accept \`me\`, an email, or a display name. Unknown \`--label\` values fail — create labels first with \`label create\`.
5. Scope to a team by placing \`--team <key|name>\` AFTER the command. Without it, the team comes from \`LINEAR_TEAM\`, a \`.linear.toml\` \`team_id\`, or the current git branch's issue identifier.
6. Scope to a project via \`--project <name>\`, or set \`LINEAR_PROJECT\` / \`.linear.toml\` \`project_id\` so list/create pick it up automatically. On list, \`--project none\` means no project; \`--project any\` ignores the ambient default. Update still requires an explicit \`--project\`.
7. Move work along with \`issue start ABC-123\` (assigns you, moves to started, creates the git branch), then \`issue close ABC-123\` when it ships.
8. Filter lists tightly (\`--state\`, \`--assignee me\`, \`--label\`, \`--parent <id|none>\`, \`--updated-since 2w\`) - narrow queries cost fewer tokens than wide ones.
9. To find startable children of a spec, use one list call: \`issue list --parent ABC-1 --state unstarted --fields blocked_by\` (direct children only). Do not \`issue view\` the parent then view each child. \`--parent none\` lists top-level issues (no parent).
10. Set issue relations with dedicated flags on create/update — never via the \`api\` escape hatch: \`issue create --title "..." --blocked-by ABC-1\`, \`issue update ABC-2 --blocks +ABC-3\`. Flags: \`--blocked-by\`, \`--blocks\`, \`--relates-to\`, \`--duplicate-of\` (repeatable). On update, \`+id\`/\`id\` adds and \`-id\` removes (same grammar as \`--label\`).
11. Every response ends with contextual next-step hints under \`help:\` - follow them.

## Commands

\`\`\`
${extractCommandsBlock()}
\`\`\`

Installed copies also inherit the SDK built-in \`update\` command.
Run \`linear-axi update --check\` to compare the installed version with npm, or \`linear-axi update\` to upgrade.
When using \`${NPX_COMMAND}\`, npx already resolves the package on demand.

Run \`${NPX_COMMAND} --help\` for global flags, or \`${NPX_COMMAND} <command> --help\` for per-command usage.

## Tips

- Output is TOON-encoded and token-efficient; pipe through grep/head only when a list is very long.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe.
- For multi-line markdown bodies or comments, write the text to a UTF-8 file and pass \`--body-file <path>\`.
- \`issue close\` moves to the team's first completed-type state; \`issue close --cancel\` uses the canceled-type state instead.
- States accept a name ("In Review") or a type (\`triage\`, \`backlog\`, \`unstarted\`, \`started\`, \`completed\`, \`canceled\`).
- \`--updated-since\` accepts friendly durations: \`2h\`, \`3d\`, \`2w\`, \`1m\`, \`1y\`, or an ISO date.
- Issue list \`--parent <id>\` is direct children only (not recursive); \`--parent none\` means no parent. Relation extras via \`--fields\`: \`blocked_by\`, \`blocks\`, \`relates_to\`, \`duplicate_of\` (comma-separated identifiers, same as \`issue view\`).
- To add or remove blockers/relations, use \`issue create\` / \`issue update\` with \`--blocked-by\`, \`--blocks\`, \`--relates-to\`, or \`--duplicate-of\` — not the GraphQL escape hatch.
- Use \`api\` only for GraphQL the dedicated commands do not cover. Output is the unwrapped \`data\` payload (no \`{"data":…}\` wrapper). Identifiers like \`ABC-123\` work wherever Linear accepts issue ids. Example: \`${NPX_COMMAND} api 'query($id:String!){ issue(id:$id){ title url } }' --input '{"id":"ABC-123"}'\`.
`;
}

/** Render Codex-facing UI metadata bundled with the skill. */
export function createSkillOpenAiYaml(): string {
  return `interface:
  display_name: "Linear AXI"
  short_description: "Operate Linear issues, projects, and workflows"
  default_prompt: "Use $linear-axi to inspect and manage work in Linear."
`;
}

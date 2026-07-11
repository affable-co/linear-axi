import { DESCRIPTION, TOP_HELP } from "./cli.js";

// Trigger string agents match against to auto-load the skill.
// Kept terse and outcome-focused so it fires on "needs Linear" intents.
export const SKILL_DESCRIPTION =
  "Operate Linear through the linear-axi CLI - issues, projects, cycles, teams, workflow states, " +
  "labels, users, documents, search, and raw GraphQL access. " +
  "Use whenever a task touches Linear: listing, filing, or updating issues, commenting, moving issues " +
  "through workflow states, starting work on an issue (git branch), checking cycles or project progress, " +
  "or searching the workspace.";

export const SKILL_AUTHOR = "Tamas Perlaky";

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
 * help), rewriting invocations to non-interactive `npx -y linear-axi-fable ...`
 * so the CLI comes along on demand.
 *
 * @returns full SKILL.md contents including YAML frontmatter
 */
export function createSkillMarkdown(): string {
  return `---
name: linear-axi
description: ${yamlDoubleQuote(SKILL_DESCRIPTION)}
user-invocable: false
author: ${SKILL_AUTHOR}
---

# linear-axi

${DESCRIPTION}

You do not need linear-axi installed globally - invoke it with \`npx -y linear-axi-fable <command>\`.
If linear-axi output shows a follow-up command starting with \`linear-axi\`, run it as \`npx -y linear-axi-fable ...\` instead.

linear-axi requires a Linear API key in the \`LINEAR_API_KEY\` environment variable (create one at https://linear.app/settings/account/security). Keys stored by schpet/linear-cli in \`~/.config/linear/credentials.toml\` are detected automatically. If a command fails with \`AUTH_REQUIRED\`, ask the user to set \`LINEAR_API_KEY\` themselves.

## When to use

Use linear-axi whenever a task touches Linear: listing, filing, editing, closing, or reopening issues; commenting on issues or reading comment threads; starting work on an issue (assigns you and creates the git branch); checking cycle or project progress; managing labels and workflow states; reading or writing documents; searching the workspace; or calling the Linear GraphQL API directly.

## Workflow

1. Run \`npx -y linear-axi-fable\` with no arguments for a dashboard - your active issues and suggested next commands.
2. Drill in command-first: \`issue list\`, \`issue view ABC-123\`, \`project view <name>\`, \`cycle view current --team <key>\`, and so on.
3. Issues accept identifiers everywhere (\`ABC-123\`, case-insensitive); teams accept keys or names; states, labels, projects, and cycles accept names; assignees accept \`me\`, an email, or a display name.
4. Scope to a team by placing \`--team <key>\` AFTER the command. Without it, the team comes from \`LINEAR_TEAM\`, a \`.linear.toml\` \`team_id\`, or the current git branch's issue identifier.
5. Move work along with \`issue start ABC-123\` (assigns you, moves to started, creates the git branch), then \`issue close ABC-123\` when it ships.
6. Filter lists tightly (\`--state\`, \`--assignee me\`, \`--label\`, \`--updated-since 2w\`) - narrow queries cost fewer tokens than wide ones.
7. Every response ends with contextual next-step hints under \`help:\` - follow them.

## Commands

\`\`\`
${extractCommandsBlock()}
\`\`\`

Installed copies also inherit the SDK built-in \`update\` command.
Run \`linear-axi update --check\` to compare the installed version with npm, or \`linear-axi update\` to upgrade.
When using \`npx -y linear-axi-fable\`, npx already resolves the package on demand.

Run \`npx -y linear-axi-fable --help\` for global flags, or \`npx -y linear-axi-fable <command> --help\` for per-command usage.

## Tips

- Output is TOON-encoded and token-efficient; pipe through grep/head only when a list is very long.
- Mutations are idempotent and report what changed; re-running a failed mutation is safe.
- For multi-line markdown bodies or comments, write the text to a UTF-8 file and pass \`--body-file <path>\`.
- \`issue close\` moves to the team's first completed-type state; \`issue close --cancel\` uses the canceled-type state instead.
- States accept a name ("In Review") or a type (\`triage\`, \`backlog\`, \`unstarted\`, \`started\`, \`completed\`, \`canceled\`).
- \`--updated-since\` accepts friendly durations: \`2h\`, \`3d\`, \`2w\`, \`1m\`, \`1y\`, or an ISO date.
- Use \`api\` for anything the dedicated commands do not cover, e.g. \`npx -y linear-axi-fable api 'query { viewer { email } }'\`.
`;
}

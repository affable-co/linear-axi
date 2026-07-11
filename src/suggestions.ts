import type { LinearContext } from "./context.js";

/**
 * Contextual next-step suggestions (AXI principle 9).
 *
 * One ordered table; first match wins. Every line is a complete runnable
 * command with placeholders (<id>, "...") for runtime values. Terminal
 * actions return [] — suggestions on self-contained output are noise.
 */
export interface SuggestionContext {
  domain: string;
  action: string;
  /** Workflow state *type* for state-aware suggestions (e.g. started, completed). */
  state?: string;
  isEmpty?: boolean;
  /** The entity identifier for substitution (e.g. ABC-123). */
  id?: string | number;
  ctx?: LinearContext;
}

type SuggestionEntry = {
  match: (c: SuggestionContext) => boolean;
  lines: (c: SuggestionContext) => string[];
};

/**
 * Append ` --team KEY` only when the team came from an explicit flag or env —
 * auto-detected sources (.linear.toml, git branch) re-resolve on the next
 * invocation without help.
 */
function teamFlag(c: SuggestionContext): string {
  const team = c.ctx?.team;
  if (team && (team.source === "flag" || team.source === "env")) {
    return ` --team ${team.team}`;
  }
  return "";
}

const OPEN_TYPES = new Set(["triage", "backlog", "unstarted", "started"]);

const table: SuggestionEntry[] = [
  // Home
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `linear-axi <command> <subcommand>` — commands: issue, project, cycle, team, state, label, user, doc, search",
    ],
  },

  // Issue list
  {
    match: (c) => c.domain === "issue" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`linear-axi issue view <id>\` to view details`,
      `Run \`linear-axi issue create${teamFlag(c) || " --team <key>"} --title "..."\` to create`,
    ],
  },
  {
    match: (c) => c.domain === "issue" && c.action === "list" && c.isEmpty === true,
    lines: (c) => [
      `Run \`linear-axi issue create${teamFlag(c) || " --team <key>"} --title "..."\` to create an issue`,
      `Run \`linear-axi issue list${teamFlag(c)} --state completed\` to see completed issues`,
    ],
  },

  // Issue view — open-ish states
  {
    match: (c) => c.domain === "issue" && c.action === "view" && OPEN_TYPES.has(c.state ?? ""),
    lines: (c) => [
      `Run \`linear-axi issue comment ${c.id} --body "..."\` to comment`,
      `Run \`linear-axi issue update ${c.id} --state <state>\` to change state`,
      `Run \`linear-axi issue start ${c.id}\` to assign yourself and create the git branch`,
      `Run \`linear-axi issue close ${c.id}\` to close`,
    ],
  },
  // Issue view — completed/canceled
  {
    match: (c) => c.domain === "issue" && c.action === "view",
    lines: (c) => [
      `Run \`linear-axi issue reopen ${c.id}\` to reopen`,
      `Run \`linear-axi issue comment ${c.id} --body "..."\` to comment`,
    ],
  },

  // Issue create / update / state changes
  {
    match: (c) => c.domain === "issue" && c.action === "create",
    lines: (c) => [
      `Run \`linear-axi issue view ${c.id}\` to see the full issue`,
      `Run \`linear-axi issue start ${c.id}\` to assign yourself and create the git branch`,
    ],
  },
  {
    match: (c) =>
      c.domain === "issue" && ["update", "close", "reopen"].includes(c.action),
    lines: (c) => [`Run \`linear-axi issue view ${c.id}\` to see the updated issue`],
  },
  {
    match: (c) => c.domain === "issue" && c.action === "comment",
    lines: (c) => [`Run \`linear-axi issue comments ${c.id}\` to see the thread`],
  },
  {
    match: (c) => c.domain === "issue" && c.action === "comments",
    lines: (c) => [
      `Run \`linear-axi issue comment ${c.id} --body "..."\` to comment`,
      `Run \`linear-axi issue comment ${c.id} --body "..." --reply-to <comment-id>\` to reply in a thread`,
    ],
  },
  {
    match: (c) => c.domain === "issue" && c.action === "start",
    lines: (c) => [
      `Run \`linear-axi issue view ${c.id}\` to see the issue`,
      `Run \`linear-axi issue close ${c.id}\` when the work ships`,
    ],
  },

  // Projects
  {
    match: (c) => c.domain === "project" && c.action === "list" && !c.isEmpty,
    lines: () => [
      "Run `linear-axi project view <name>` for progress and details",
      "Run `linear-axi issue list --project <name>` to see a project's issues",
    ],
  },
  {
    match: (c) => c.domain === "project" && c.action === "list" && c.isEmpty === true,
    lines: () => ['Run `linear-axi project create --name "..." --team <key>` to create a project'],
  },
  {
    match: (c) => c.domain === "project" && c.action === "view",
    lines: (c) => [`Run \`linear-axi issue list --project "${c.id}"\` to see its issues`],
  },
  {
    match: (c) => c.domain === "project" && ["create", "update"].includes(c.action),
    lines: (c) => [`Run \`linear-axi project view "${c.id}"\` to see the project`],
  },

  // Cycles
  {
    match: (c) => c.domain === "cycle" && c.action === "list",
    lines: (c) => [
      `Run \`linear-axi cycle view current${teamFlag(c) || " --team <key>"}\` for the active cycle`,
      `Run \`linear-axi issue list --cycle current${teamFlag(c)}\` to see current-cycle issues`,
    ],
  },
  {
    match: (c) => c.domain === "cycle" && c.action === "view",
    lines: (c) => [
      `Run \`linear-axi issue list --cycle ${c.id ?? "current"}${teamFlag(c)}\` to see its issues`,
    ],
  },

  // Teams / states / labels / users
  {
    match: (c) => c.domain === "team" && c.action === "list",
    lines: () => ["Run `linear-axi team view <key>` for states, labels, and members"],
  },
  {
    match: (c) => c.domain === "team" && c.action === "view",
    lines: (c) => [
      `Run \`linear-axi issue list --team ${c.id}\` to see the team's issues`,
      `Run \`linear-axi cycle view current --team ${c.id}\` for the active cycle`,
    ],
  },
  {
    match: (c) => c.domain === "state" && c.action === "list",
    lines: () => ["Run `linear-axi issue update <id> --state <state>` to move an issue"],
  },
  {
    match: (c) => c.domain === "label" && c.action === "list",
    lines: (c) => [`Run \`linear-axi issue list${teamFlag(c)} --label <name>\` to filter by label`],
  },
  {
    match: (c) => c.domain === "user" && c.action === "list",
    lines: (c) => [`Run \`linear-axi issue list${teamFlag(c)} --assignee <name>\` to see a user's issues`],
  },

  // Docs
  {
    match: (c) => c.domain === "doc" && c.action === "list" && !c.isEmpty,
    lines: () => ["Run `linear-axi doc view <id>` to read a document"],
  },
  {
    match: (c) => c.domain === "doc" && c.action === "list" && c.isEmpty === true,
    lines: () => ['Run `linear-axi doc create --title "..." --body "..."` to create a document'],
  },
  {
    match: (c) => c.domain === "doc" && ["create", "update"].includes(c.action),
    lines: (c) => [`Run \`linear-axi doc view ${c.id}\` to read the document`],
  },

  // Search
  {
    match: (c) => c.domain === "search" && !c.isEmpty,
    lines: () => ["Run `linear-axi issue view <id>` to open a result"],
  },
  {
    match: (c) => c.domain === "search" && c.isEmpty === true,
    lines: (c) => [
      `Run \`linear-axi issue list${teamFlag(c)}\` to browse issues instead`,
    ],
  },
];

export function getSuggestions(context: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(context)) {
      return entry.lines(context);
    }
  }
  return [];
}

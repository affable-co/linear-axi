# linear-axi — Design Spec

Linear CLI for agents, designed with [AXI](https://axi.md) (Agent eXperience Interface).

Talks directly to the Linear GraphQL API (`https://api.linear.app/graphql`) with
hand-written minimal queries (complexity budget: 10k/query, 3M/hr — never use fat
SDK fragments).

## Positioning vs existing CLIs

| | schpet/linear-cli | linearis | linear-axi (this) |
|---|---|---|---|
| Output | tables / `--json` | JSON-only | **TOON** (~40% fewer tokens than JSON) |
| Discoverability | help text | 2-tier usage docs | **content-first home + `help[]` hints + session hook** |
| Aggregates | no | no | **totals, progress, comment counts inline** |
| Empty states | blank | `[]` | **explicit `0 found` messages** |
| Unknown flags | ignored/error | error | **exit 2 + inline valid-flag list** |
| Git integration | best-in-class | none | **kept: `issue start`, branch inference** |

Known traps from the incumbents to avoid: silent list truncation, inconsistent
name-vs-UUID resolution across flags, filter combos that silently return empty,
undocumented field caps.

## Auth

1. `LINEAR_API_KEY` env var (header: `Authorization: <key>` — no Bearer prefix)
2. Fallback: `~/.config/linear/credentials.toml` (shared with schpet/linear-cli —
   zero-setup for its users)
3. Neither → structured error with setup instructions, exit 1

Never prompt interactively.

## ID & name resolution (one shared resolver, used consistently by every flag)

- Issues: `ABC-123` identifiers (also bare `123` when team inferable from git
  branch or `--team`); UUIDs pass through
- Teams: key (`ENG`), name, or UUID — case-insensitive
- States/labels/projects/cycles: name (case-insensitive) or UUID; cycles also
  accept `current`/`next`/`previous`
- Users: `me`, email, display name, or UUID
- Relative dates: `2w`, `3d`, `1m` → ISO 8601 durations (`-P2W`) for API filters

## Command surface

```
linear-axi                      # home: bin, description, viewer, teams, my active issues, help[]
linear-axi issue list           # --team --assignee --state --label --project --cycle
                                # --priority --query --updated-since --limit --fields --sort
linear-axi issue view <id>      # truncated body + aggregates (comments, attachments, subs,
                                # blocked_by / blocks / relates_to / duplicate_of)
                                # --full --comments
linear-axi issue create         # --team --title [--body|stdin] --assignee --state --label
                                # --priority --project --parent --estimate --due
                                # --blocked-by --blocks --relates-to --duplicate-of
linear-axi issue update <id>    # same axes; --label / relation flags support +add / -remove
linear-axi issue close <id>     # idempotent; → first completed-type state; --cancel for canceled
linear-axi issue reopen <id>    # idempotent
linear-axi issue comment <id>   # --body | stdin; --reply-to <comment-id>
linear-axi issue comments <id>  # threaded list
linear-axi issue start <id>     # assign me + move to started + create/checkout git branch (branchName)
linear-axi issue branch <id>    # print branch name only
linear-axi search <text>        # full-text issue search
linear-axi project list|view    # progress aggregate inline: "12/30 done, 5 in progress"
linear-axi project create|update
linear-axi cycle list|view      # --team; scope/completed aggregates; current cycle highlighted
linear-axi team list|view       # view includes states + labels + member count (kills 3 round trips)
linear-axi state list --team
linear-axi label list [--team]  # workspace + team labels
linear-axi user list|view
linear-axi doc list|view|create|update
linear-axi api <graphql>        # raw GraphQL escape hatch (--input for variables JSON);
                                # prints unwrapped data JSON; identifiers accepted
linear-axi setup                # install session hook (Claude Code/Codex/OpenCode) + skill
```

## Output rules (AXI §1–5)

- TOON on stdout; errors also on stdout; stderr only for debug
- List defaults: 4 fields — issues: `{id,title,state,assignee}`; everything else
  3–4 fields. `--fields` extends list commands only (not view), validated against a known-field set
- Create/update echo the fields that were set (labels, project, parent, assignee, state,
  relations, …) so callers need not follow up with `issue view` to verify
- Every list: `count: N` header with `(more available)` when truncated — never invent totals;
  a `help[]` hint reveals how to get more when truncated
- Detail bodies truncated at 1200 chars with `(truncated, N chars total)` +
  `--full` hint, only when actually truncated
- Empty: `issues: 0 found matching --state done --team ENG` (echo the filters)
- Aggregates: issue view shows `comments: 7`, project rows show progress,
  cycle view shows scope/completed/started counts
- `help[]` after lists and mutations; omitted on self-contained detail views
- Priority rendered as name (`urgent/high/medium/low/none`), not magic number
- Unknown `--label` values fail with `NOT_FOUND` (labels are never auto-created)

## Errors & exit codes (AXI §6)

- 0 success (including idempotent no-ops: closing a closed issue → `issue: ABC-123 already closed (no-op)`)
- 1 real errors (API failure, not found, auth) — translated, never raw GraphQL
- 2 usage errors: unknown flag/command, missing required flag — message names the
  offender and lists the command's valid flags inline
- Rate limit responses surface `X-RateLimit-*` reset info
- Mutations are idempotent where the API allows

## Discoverability (AXI §7–10)

- `setup` installs a SessionStart hook (Claude Code `~/.claude/settings.json`,
  Codex `hooks.json`, OpenCode plugin) that prints a compact dashboard (viewer +
  my active issues); idempotent, path-repairing
- Installable Agent Skill generated from the home view via a build script with
  `--check` CI drift guard (gh-axi pattern)
- Home view: `bin:` path (~-collapsed), one-line description, live data
- Every subcommand: concise `--help` with flags, defaults, 2–3 examples

## Implementation

TypeScript, Node ≥ 20, matching gh-axi conventions (structure, TOON serializer,
args, errors, fields, suggestions modules; vitest; npx-runnable single package
named `linear-axi`). Details per gh-axi implementation report.

# linear-axi — project agent memory

Sharp edges and conventions. Do not repeat what the codebase already shows; prefer rewriting
or pruning over appending.

## Runtime

- The generic CLI runtime (dispatch, `--help`/`--version`, home header, built-in `update`,
  session-hook installer) comes from `axi-sdk-js`. Do not register an `update` command.
- `TOP_HELP` in src/cli.ts is a *prefix* of rendered help — the SDK appends a `"built-in":`
  block. The skill generator extracts the `commands[N]:` block from it; keep that shape.
- Exit codes come from `exitCodeForError`: `VALIDATION_ERROR` → 2, everything else → 1.
  Handlers never call `process.exit`; they return strings or throw `AxiError`.

## Linear API

- Hand-written minimal GraphQL only — never SDK fragments. Linear budget: 10k complexity
  points per query, 3M/hour. Select only fields you render.
- Personal API keys are sent as a bare `Authorization:` header value (no `Bearer`).
- Linear connections have `pageInfo.hasNextPage` but no `totalCount` — count lines use
  `formatCountLine({ hasMore })`, never invent totals.
- `issue(id:)` accepts `ABC-123` identifiers as well as UUIDs.
- Priority is numeric: 0 none, 1 urgent, 2 high, 3 medium, 4 low. Render names via
  `priorityName()`; parse with the inverse map in issue.ts.
- Date comparators accept ISO 8601 durations (`-P2W`); `src/dates.ts` converts `2w` forms.

## Conventions

- `--team` is the one global flag: stripped by `withTeamContext` in cli.ts before handlers
  run. Per-command `rejectUnknownFlags` never sees it; do not add it to allowed-flag lists.
- Every subcommand calls `rejectUnknownFlags` FIRST, before consuming any flag.
- Every resolver error inlines the valid options ("Available: …") when the set is bounded.
- Mutations are read-check-write idempotent; no-ops return `message: Already …` with exit 0.
- Suggestions live only in src/suggestions.ts (one ordered table, first match wins). Team
  flags appear in suggestions only for flag/env sources — never for config/branch.
- `issue branch` prints a bare branch name (no TOON) on purpose: composable with
  `git checkout -b $(linear-axi issue branch ABC-123)`.
- Secrets never appear in argv or output. Never block on interactive stdin — if input is
  required and stdin is a TTY, throw immediately.
- Regenerate the skill after changing TOP_HELP/DESCRIPTION: `pnpm run build:skill`
  (CI-checkable with `--check`). Never hand-edit generated files under skills/linear-axi.

## Publishing

- npm package and installed binary are both named `linear-axi`. Skill docs teach
  `npx -y linear-axi`.

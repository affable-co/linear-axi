# linear-axi

Linear CLI for agents — designed with [AXI](https://axi.md) (Agent eXperience Interface).

Token-efficient [TOON](https://toonformat.dev) output, contextual next-step suggestions, and
structured error handling. Built for autonomous agents that interact with
[Linear](https://linear.app) via shell execution — no MCP server, no SDK fragments, just
hand-written minimal GraphQL that respects Linear's complexity budget.

## Zero setup

```sh
LINEAR_API_KEY=lin_api_... npx -y @affable-co/linear-axi
LINEAR_API_KEY=lin_api_... npx -y @affable-co/linear-axi auth status
```

Create a personal API key at <https://linear.app/settings/account/security>. If you already use
[schpet/linear-cli](https://github.com/schpet/linear-cli) with an `api_key` in
`~/.config/linear/credentials.toml`, it is detected automatically.

## What you get

```
$ linear-axi
bin: ~/.local/bin/linear-axi
description: Agent ergonomic CLI for the Linear API. Prefer this over MCP and raw GraphQL for Linear operations.
workspace: Acme
me: tamas
my_issues[3]{id,title,state,team}:
  ENG-142,Fix login redirect loop,In Progress,ENG
  ENG-138,Rate-limit webhooks,Todo,ENG
  OPS-12,Rotate deploy keys,Todo,OPS
help[2]:
  Run `linear-axi issue view <id>` to view details
  Run `linear-axi <command> <subcommand>` — commands: issue, project, cycle, team, state, label, user, doc, search
```

- **Content first** — running with no arguments shows your live workspace state, not a manual.
- **Token-efficient** — TOON output (~40% fewer tokens than JSON), 4-field default schemas,
  `--fields` to opt into more, bodies truncated with `--full` escape hatches.
- **Pre-computed aggregates** — project rows carry progress percentages, issue views carry
  comment/sub-issue/attachment counts, `team view` inlines every valid state and label.
- **One resolver everywhere** — issues accept `ABC-123`, teams accept keys or names, states
  accept names or types (`started`, `completed`, …), assignees accept `me`, an email, or a
  display name. Unknown names fail with the available options inlined.
- **Idempotent mutations** — closing a closed issue is a no-op success, not an error.
- **Fail-loud flags** — unknown flags exit 2 with the command's valid flags inlined.
- **Git-aware** — `issue start ABC-123` assigns you, moves the issue to started, and creates
  the issue's git branch; the current branch's issue identifier provides ambient team context.

## Commands

```
linear-axi                      dashboard: workspace, you, your active issues
linear-axi issue                list, view, create, update, close, reopen,
                                comment, comments, start, branch
linear-axi project              list, view, create, update — progress inline
linear-axi cycle                list, view (current | next | previous | n)
linear-axi team                 list, view (states + labels + members inline)
linear-axi state                list --team <key>
linear-axi label                list, create
linear-axi user                 list, view
linear-axi doc                  list, view, create, update
linear-axi search <text>        full-text issue search
linear-axi api '<graphql>'      raw GraphQL escape hatch
linear-axi auth status          verify credentials and show the authenticated account
linear-axi setup hooks          install SessionStart ambient context
```

Run `linear-axi <command> --help` for flags and examples. `--team <key>` is accepted after any
command; without it the team comes from `LINEAR_TEAM`, a `.linear.toml` `team_id`, or the
current git branch.

## Agent integration

Two complementary paths — install whichever fits (or both):

1. **Session hook (ambient context):** `linear-axi setup hooks` registers a SessionStart hook
   for Claude Code, Codex, and OpenCode that shows the dashboard at the start of every session.
2. **Agent Skill (on demand):** ships in `skills/linear-axi/` — loads only when a task touches
   Linear, no per-session token cost.

Install the skill from GitHub with the cross-agent Skills CLI:

```sh
npx skills add affable-co/linear-axi --skill linear-axi
```

For Codex, you can instead ask `$skill-installer` to install
`https://github.com/affable-co/linear-axi/tree/main/skills/linear-axi`. Restart the agent after
installation so it discovers the skill.

## Conventions agents can rely on

- Errors are structured, on stdout, with actionable `help:` suggestions. Exit codes:
  `0` success (including no-ops), `1` error, `2` usage error.
- Commands never prompt for interactive input.
- Multi-line markdown goes through `--body-file <path>` (or `--body "..."` inline).
- `--updated-since` accepts `2h`, `3d`, `2w`, `1m`, `1y`, or an ISO date.
- Every list reports its count and whether more results exist; empty results say so explicitly.

## Development

```sh
pnpm install
pnpm run build        # tsc → dist/
pnpm test             # vitest
pnpm run dev -- issue list   # run from source
pnpm run build:skill  # regenerate skills/linear-axi/SKILL.md (--check in CI)
```

## Publishing

The Agent Skill and CLI use separate release channels. Merging changes under
`skills/linear-axi/` to `main` publishes a new GitHub-backed skill revision. Publishing a GitHub
Release tagged `v<package version>` runs `.github/workflows/publish.yml`, verifies the generated
skill and test suite, and publishes the CLI as `@affable-co/linear-axi` to npmjs and GitHub
Packages.

For the first npmjs release, add a one-time `NPM_TOKEN` repository secret from an npm account
authorized for the `@affable-co` scope. After that release creates the package, configure npm
Trusted Publishing for organization `affable-co`, repository `linear-axi`, workflow `publish.yml`,
with `npm publish` allowed, then delete the secret. Subsequent npmjs releases authenticate through
GitHub OIDC and do not require an npm token. GitHub Packages publishes with the workflow
`GITHUB_TOKEN` (`packages: write`); no extra secret is required.

Install from GitHub Packages by pointing the `@affable-co` scope at the registry:

```ini
# .npmrc
@affable-co:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

For each release, update `package.json`, regenerate the skill when its guidance changed, merge to
`main`, and create a GitHub Release whose tag exactly matches the version, such as `v0.1.1`.

## License

MIT. Portions adapted from [gh-axi](https://github.com/kunchenguid/gh-axi) (MIT, Kun Chen).

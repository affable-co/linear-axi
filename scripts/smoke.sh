#!/usr/bin/env bash
# Read-only live smoke test against the real Linear API.
# Usage: LINEAR_API_KEY=lin_api_... scripts/smoke.sh [TEAM_KEY]
# Exercises every read path once; performs NO mutations.
set -uo pipefail

cd "$(dirname "$0")/.."
BIN="node dist/bin/linear-axi.js"
TEAM="${1:-}"
pass=0 fail=0

run() {
  local desc="$1"; shift
  echo "──── $desc"
  echo "\$ linear-axi $*"
  if $BIN "$@"; then
    pass=$((pass + 1))
  else
    echo "^^ EXIT $? — FAILED"
    fail=$((fail + 1))
  fi
  echo
}

[ -n "${LINEAR_API_KEY:-}" ] || { echo "Set LINEAR_API_KEY first"; exit 2; }
npm run -s build >/dev/null

run "dashboard (home)"
run "team list" team list
if [ -z "$TEAM" ]; then
  TEAM=$($BIN team list | sed -n 's/^  \([A-Z0-9]*\),.*/\1/p' | head -1)
  echo "(using first team: $TEAM)"
fi
run "team view" team view "$TEAM"
run "state list" state list --team "$TEAM"
run "label list" label list --team "$TEAM"
run "user list" user list --limit 10
run "user view me" user view me
run "issue list (team)" issue list --team "$TEAM" --limit 5
run "issue list assignee=me + state type" issue list --assignee me --state started --limit 5
run "issue list updated-since" issue list --team "$TEAM" --updated-since 2w --limit 5
run "issue list extra fields" issue list --team "$TEAM" --limit 3 --fields labels,priority,updated
ISSUE=$($BIN issue list --team "$TEAM" --limit 1 | sed -n 's/^  \([A-Z0-9]*-[0-9]*\),.*/\1/p' | head -1)
if [ -n "$ISSUE" ]; then
  echo "(using issue: $ISSUE)"
  run "issue view" issue view "$ISSUE"
  run "issue view --comments --full" issue view "$ISSUE" --comments --full
  run "issue comments" issue comments "$ISSUE"
  run "issue branch" issue branch "$ISSUE"
fi
run "project list" project list --limit 5
PROJECT=$($BIN project list --limit 1 | sed -n 's/^  \([^,]*\),.*/\1/p' | head -1 | tr -d '"')
[ -n "$PROJECT" ] && run "project view" project view "$PROJECT"
run "cycle list" cycle list --team "$TEAM"
run "cycle view current" cycle view current --team "$TEAM"
run "doc list" doc list --limit 5
run "search" search "the" --limit 3
run "api viewer" api '{ viewer { email } }'

echo "════ smoke: $pass passed, $fail failed"
[ "$fail" -eq 0 ]

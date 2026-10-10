#!/usr/bin/env bash
# Starts (or resumes) one headless Claude Code agent for a work package, inside its own worktree, so
# the repo's .claude hooks run on it. How to use it and why it is shaped this way:
# .claude/skills/agent-orchestration/SKILL.md.
#
#   scripts/agents/run-agent.sh <run-dir> <WP> <haiku|sonnet> [start|resume] [message-file]
#
#   <run-dir>       absolute folder with common.md, <WP>.md (the brief) and where <WP>.log is written
#   <WP>            package id; its worktree is .worktrees/<wp lowercased>
#   haiku | sonnet  claude-haiku-5-5 at max effort, or claude-sonnet-5-5 at low effort. Explicit ids:
#                   the `haiku` alias still resolves to Haiku 4.5.
#   start           a fresh session from common.md + <WP>.md (the default; use it for every new round)
#   resume          continue the logged session with [message-file] (only within a round: resumed
#                   sessions thrash after a few rounds)
#
# Environment:
#   APIARY_BASE_REF the branch the worktree was made from (default: the main checkout's branch);
#                   the Stop hook checks only the commits since it.
#   AGENT_REPORT    absolute path of the report the brief asks for. When set, a watchdog stops the
#                   agent once its work is evidently finished: the report exists, the worktree is
#                   clean, and HEAD has not moved for AGENT_IDLE_MIN minutes (default 15). A 1.35.0
#                   agent (H2) finished and committed its code, then spent over an hour re-checking
#                   and rewriting its report, compacting again and again. The lead verifies the branch
#                   with the Stop hook anyway, so a polished report is not worth that hour.
#
# Copy this script before running agents and never edit a copy that is executing: bash reads a
# script as it runs, and an edit mid-run makes it fail with a syntax error.
set -u
RUN_DIR="$1"; WP="$2"; KIND="$3"; MODE="${4:-start}"
MSGFILE=""
[ -n "${5:-}" ] && MSGFILE="$(cd "$(dirname "$5")" && pwd)/$(basename "$5")"   # absolute before cd
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WT="$ROOT/.worktrees/$(echo "$WP" | tr '[:upper:]' '[:lower:]')"

case "$KIND" in
  haiku)  MODEL=(--model claude-haiku-5-5 --effort max) ;;
  sonnet) MODEL=(--model claude-sonnet-5-5 --effort low) ;;
  *) echo "model must be haiku or sonnet" >&2; exit 2 ;;
esac

# Headless: --permission-mode auto refuses file writes, so edits are auto-accepted (acceptEdits) and
# Bash is an explicit allowlist. Publishing, hook-skipping, stashing and installs are denied outright,
# so those rules hold mechanically, not only because the brief says so.
ALLOW=("Bash(npm run:*)" "Bash(npm test:*)" "Bash(npx:*)" "Bash(git:*)" "Bash(node:*)" "Bash(ls:*)" "Bash(cat:*)" "Bash(grep:*)" "Bash(rg:*)" "Bash(find:*)" "Bash(head:*)" "Bash(tail:*)" "Bash(wc:*)" "Bash(sed -n:*)" "Bash(mkdir:*)" "Bash(pgrep:*)" "Bash(pkill:*)" "Bash(ps:*)" "Bash(diff:*)" "Bash(sort:*)")
DENY=("Bash(git push:*)" "Bash(git tag:*)" "Bash(git stash:*)" "Bash(git commit --no-verify:*)" "Bash(git commit -n:*)" "Bash(npm install:*)" "Bash(npm ci:*)" "Bash(npm i:*)" "Bash(npm version:*)" "Bash(gh:*)")
COMMON=("${MODEL[@]}" --permission-mode acceptEdits --add-dir "$RUN_DIR" --allowedTools "${ALLOW[@]}" --disallowedTools "${DENY[@]}" --output-format stream-json --verbose)

cd "$WT" || { echo "no worktree $WT" >&2; exit 2; }
# The Stop hook judges the agent's own commits: everything since it left the release branch.
export APIARY_BASE_REF="${APIARY_BASE_REF:-$(git -C "$ROOT" branch --show-current)}"

# Runs claude in the background and returns once it exits or the watchdog stops it.
run_claude() {
  "$@" &
  local pid=$! head since
  head=$(git rev-parse HEAD); since=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    sleep 60
    if [ "$(git rev-parse HEAD)" != "$head" ] || [ -n "$(git status --porcelain)" ]; then
      head=$(git rev-parse HEAD); since=$(date +%s); continue
    fi
    if [ -n "${AGENT_REPORT:-}" ] && [ -f "$AGENT_REPORT" ] && [ $(( $(date +%s) - since )) -ge $(( ${AGENT_IDLE_MIN:-15} * 60 )) ]; then
      echo "{\"type\":\"watchdog\",\"note\":\"stopped: report written, tree clean, HEAD unchanged for ${AGENT_IDLE_MIN:-15} min\"}" >> "$RUN_DIR/$WP.log"
      kill "$pid" 2>/dev/null
      break
    fi
  done
  wait "$pid" 2>/dev/null
}

if [ "$MODE" = resume ]; then
  SID=$(head -1 "$RUN_DIR/$WP.log" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).session_id)}catch{}})')
  MSG="You were stopped. Continue your task exactly where you left off, then finish with the report."
  [ -n "$MSGFILE" ] && MSG="$(cat "$MSGFILE")"
  run_claude claude -p "$MSG" --resume "$SID" "${COMMON[@]}" >> "$RUN_DIR/$WP.log" 2>&1
else
  : > "$RUN_DIR/$WP.log"
  run_claude claude -p "$(cat "$RUN_DIR/common.md")

$(cat "$RUN_DIR/$WP.md")" "${COMMON[@]}" >> "$RUN_DIR/$WP.log" 2>&1
fi
echo "exit $? for $WP"
tail -1 "$RUN_DIR/$WP.log" | grep -o '"terminal_reason":"[^"]*' || true
tail -c 2000 "$RUN_DIR/$WP.log" | grep -o '"result":"[^"]*' | tail -1 | cut -c1-500
GD=$(git rev-parse --absolute-git-dir)
[ -f "$GD/apiary-not-done" ] && { echo "!! NOT DONE marker:"; head -20 "$GD/apiary-not-done"; }
exit 0

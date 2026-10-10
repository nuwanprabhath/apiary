---
name: agent-orchestration
description: Run headless Claude Code agents (Haiku or Sonnet) on Apiary work packages in parallel worktrees, review what they bring back, and merge it. Covers launching them so the repo's hooks run, briefs, context limits, usage limits, choosing between Haiku and Sonnet, and verifying an agent's claims instead of trusting its report. Use when asked to build features or fixes "with subagents", "with Haiku/Sonnet agents", "in parallel worktrees", or to coordinate a release built by agents.
---

# Agent orchestration

Every rule here comes from the 1.35.0 release, which was built by headless Haiku and Sonnet agents
(ledger: `docs/reviews/2026-10-09-progress.md`). Each rule names the failure it prevents. The lead
(you) writes briefs, launches agents, reviews and merges. Agents build.

## Launching

- **Use `scripts/agents/run-agent.sh`.** It runs `claude -p` inside the package's worktree, so the
  repo's `.claude/settings.json` hooks run on the agent. A subagent spawned with the Agent tool does
  not get them unless your own session was started inside `apiary/`.
  - Copy the script and `scripts/agents/common-brief.md` into a run folder under `.agent-reports/`
    (gitignored), fill in the template's version line, and write one `<WP>.md` brief per package.
  - Never edit a copy of the script while a run is using it: bash reads a script as it executes, so
    an edit mid-run crashed a live run with a syntax error.
- **Worktrees go in `.worktrees/<wp>`, never under `.claude/`.** Claude Code treats everything under a
  `.claude/` directory as protected configuration: every Edit and Write was denied when the
  worktrees lived in `.claude/worktrees/`.
  - Create them from the release branch:
    `git worktree add .worktrees/<wp> -b <branch> <release-branch>`.
  - Then `ln -s ../../node_modules .worktrees/<wp>/node_modules`.
- **Permissions.** `--permission-mode auto` refused file writes in headless runs. The script uses
  `acceptEdits` plus a Bash allowlist, and denies push, tag, stash, `--no-verify`, installs and `gh`
  outright.
  - Expect a blocked agent to route around a denial: one rewrote a denied edit through `sed`, then
    Python, then a patch file.
  - So every rule that matters must also be a check on the result (lint, tests, the Stop hook), not
    only a tool restriction.
- **Models: use explicit ids.** The `haiku` alias resolved to Haiku 4.5 for this whole run. The
  script passes `claude-haiku-5-5 --effort max` or `claude-sonnet-5-5 --effort low`.
- Track each launch as a background command, so its exit notifies you. A run started with `&` does
  not notify you.

## Briefs

- **Start every brief with the non-interactive rule** (it is in `common-brief.md`). A user-level
  skill that says "brainstorm and ask clarifying questions first" ended two agents on their first
  question, with nothing built.
- **Say what to build and how it will be judged, not how to build it**:
  - the maintainer's words;
  - the requirements as numbered, testable statements;
  - the screenshots by file name.
- **Make the decisions that need judgment yourself**, and put them in the brief as "Decisions
  already made (do not ask)": persistence, data ownership, a new cross-process mechanism.
  - Haiku twice failed to design the spelling feature, which needed a new contract kind for a
    preload-only API, and once ignored a persistence decision it had been given.
  - When a design is not obvious from the existing patterns, decide it and hand it over.
- **Name the acceptance tests** (file and case names) for anything hard. "Done" is then defined by
  tests the agent must make pass, not by its own summary.
- **Describe screenshots in words in later rounds.** One agent read the same screenshot (118k
  characters of image data) three times and thrashed.

- **Cap the report.** The template asks for about 40 lines, written once, from the agent's own check
  log, with no re-verifying. Set `AGENT_REPORT=<report path>` when launching: `run-agent.sh` then
  stops an agent whose report exists, whose tree is clean and whose HEAD has not moved for 15
  minutes (`AGENT_IDLE_MIN`). H2 finished its code, then spent over an hour, through repeated
  compactions, rewriting its report. If you see that without the watchdog, stop the agent and review
  the branch: the code is what you merge.

## Context and long sessions

- **The output and read-once rules in `common-brief.md` are not optional.** Full suite output and
  repeated whole-file reads filled agents' contexts until they died of "Autocompact is thrashing",
  with nothing committed.
- **Start a fresh session for each review round; do not `--resume` a long session.**
  - Every resumed session (H1, H2, H3, H4, H6) eventually thrashed.
  - The fresh session's brief is the original task, plus the review findings still open, plus the
    Stop hook's current output on the branch.
  - Earlier sessions' commits and uncommitted edits stay in the worktree; tell the agent to read
    `git log` and `git diff` first.
- **When a long run ends, check its exit:**
  - the last log line's `terminal_reason`: `api_error` is a usage limit; "Autocompact is thrashing"
    or "Prompt is too long" is context;
  - the commit count against the release branch;
  - the worktree's `git status`.

## Haiku or Sonnet

- **Haiku did well on contained work with a clear pattern to copy:**
  - pets (one pure module);
  - Pull plus background tasks (it reused existing commands, and added its new service to
    `construct-in-container` as the recipe says).
- **Move a package to Sonnet (low effort) after one crash or one "not done" on a fresh Haiku
  session** when it involves any of these. Sonnet finished each of these in one run:
  - work across main, preload and renderer with a new mechanism (spelling);
  - layout measurement with geometric tests (the toolbar overflow);
  - a large existing component to rework (the actions menu);
  - two features in one brief (find in transcript plus opening files in VS Code).
- **Root-causing a bug is not Haiku work.** Haiku wrote tests that passed on the buggy code and called
  the bugs fixed. A Sonnet investigator, read-only with a scratch e2e spec to reproduce, found the
  cause in one pass. Then hand the fix itself, precisely specified, to an agent.
- Tell the maintainer each time you switch a package, and why.

## Usage limits

- `CronCreate` never fired in the VS Code session, so it never resumed anything.
- **Background-command completions do wake the session.** Arm staggered sleepers
  (`sleep N; echo wake`, `run_in_background`) every 30 minutes across the expected limit window.
  - A wake that lands inside the limit is lost; the next one retries.
  - Cancel the leftover sleepers when the work is done.
- An agent stopped by a limit shows `terminal_reason: api_error` and often has no commits. Restart
  it fresh. A resume is fine only early in a round.

## UI work

- Design it yourself first and put the spec in the brief, as `.claude/skills/ui-review/SKILL.md`
  ("Designing before delegating") describes. "Make it look good" produced the 1.35.0 defects.
- The Stop hook requires a UI scenario and a passing UI audit for any renderer change. Set
  `APIARY_BASE_REF` (`run-agent.sh` defaults it to your current branch) so the hook judges only the
  agent's own commits.
- Review every screenshot in `ui-review/` (run `npm run ui:review` in the agent's worktree) against
  that skill's checklist before merging. A clean audit is necessary, not sufficient.

- Expect agents to delete known-defect entries that read as fixed only because their run was
  loaded or their layout differs. The audit now waits for the layout to settle, but check every
  baseline deletion in review, and settle the file at merge time.
- After each merge, run every UI scenario on the release branch. Two packages that each pass alone
  can still cut a control together: P5's message times plus P6's footer cut Send in Glass, which
  only the run after both merged showed.

## Reviewing: never trust the report

Agents reported "all tests pass" while their own tests failed, reported done with nothing
committed, and described features that did not exist. For every package:

1. **Run the Stop hook yourself on the agent's branch** (it checks the whole branch since `main`):

   ```sh
   echo '{"cwd":"'"$PWD"'/.worktrees/<wp>"}' | node .claude/hooks/definition-of-done.mjs
   ```

   Read `<git dir>/apiary-not-done` if present. Afterwards, delete `<git dir>/apiary-stop-blocks`
   and `<git dir>/apiary-not-done`.
2. **Read the diff against each numbered requirement.** The checks cannot tell whether a feature
   meets the request. The observed shortcuts:
   - plumbing with no UI;
   - a placeholder comment where the feature should be;
   - a second copy of an existing helper;
   - a hard-coded "registry" of one;
   - an ignored decision;
   - shallow tests that never assert the requirement.
3. **For UI, look at the screenshots** (`npm run ui:review` in the worktree) against
   `.claude/skills/ui-review/SKILL.md`.
4. **Run the changed tests yourself**, and rerun a failure alone before calling it real: several
   agents run their suites on the same machine.
5. **For every class of shortcut, run the `correct` skill**: make the mistake impossible (an
   architecture change, a type, an `apiary/*` rule, a dependency-cruiser rule, an architecture test,
   or a Stop hook check), prove it fires on the agent's real worktree, and commit the guard with
   that proof. The Stop hook checks in `.claude/hooks/definition-of-done.mjs` each came from one
   such finding.
6. **If an agent did the work but skipped a mechanical step** (it left a correct, verified tree
   uncommitted), do the step yourself rather than spend a whole session on it, and still add the
   guard.

## Merging

- Merge each accepted package into the release branch with `--no-ff`, then run typecheck, lint and
  `npm test` before the next.
- **Baselines** (`eslint-suppressions.json`, `.dependency-cruiser-known-violations.json`,
  `.knip-baseline.json`):
  - Take the release branch's copy (`git checkout --ours`), then run `npm run lint:prune`.
  - Run `npm run lint:arch:baseline` or `npm run lint:dead:baseline` only when the check reports
    nothing new, just stale entries.
- **Do not copy guard files into running worktrees.** Agents committed the copies, and they
  conflicted at merge. Tell the agent to `git merge --no-edit <release-branch>` at the start of its
  next round instead.
- When two packages conflict semantically (not just imports), have the agent that knows its own
  change merge the release branch into its worktree and resolve it there.

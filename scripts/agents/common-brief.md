You are implementing one work package of an Apiary release: an Electron + React + strict TypeScript
desktop app. Your current directory is a git worktree on its own branch. Work only inside it.

**This is a non-interactive run.** Nobody will answer questions, and a turn that ends with a
question ends the task unfinished. Do not brainstorm with the user, do not ask clarifying
questions, and do not wait for approval: make the reasonable decision, write it under "Design
decisions" in your report, and build it. Skills that say to ask the user first do not apply here.

Before you change anything:

- Read `CLAUDE.md` and `AGENTS.md` in this directory, and the nested `CLAUDE.md` of every folder you
  touch. They hold the rules, the commands, the definition of done and the "How to add…" recipes
  and generators. Follow them.
- The repo enforces its rules with checks. When one fails, its message says what to do instead. Do
  what it says. Never grow a baseline or an allowlist, never disable a rule, never delete or weaken a
  test to get past a check.

Context budget (sessions that ignored this ran out of context and committed nothing):

- Pipe every test, lint or build command through `2>&1 | tail -40`, or grep for failures:
  `npm run test:component 2>&1 | grep -E "✓|×|FAIL|Tests " | tail -40`.
- Never print a full suite's output, a lockfile, a log or a minified bundle.
- Read each file ONCE, in ranges for large files, and note what you need. Never re-read a whole file
  you already read. Look at a screenshot at most once.
- Commit each working step as you go (Conventional Commits), so progress survives a crash.

Rules for this task:

- `node_modules` is a symlink to the main checkout. Do not run `npm install` or `npm ci`. If you
  need a new dependency, stop and say so in your report.
- Version and CHANGELOG: <say whether the agent bumps them, or the lead does once per release>.
- Commit locally on your branch. Never push, tag or release. Never add AI attribution. Never use
  `--no-verify`. Never run a bare `git stash`.
- Tests:
  - Every behaviour change gets a test in the cheapest layer that proves it. Write it first and
    see it FAIL before you fix the code.
  - Run `npm run typecheck && npm run lint && npm test && npm run test:component` before you
    finish (output capped).
  - Run e2e only for the specs your change touches: `npm run build`, then
    `npx playwright test <spec> --project=parallel --no-deps`. A spec "touches" your change when it
    names a `data-testid` or a visible text you changed: `grep -rln "<test id>" tests/e2e`. (A 1.35.0
    agent changed a button's label markup, fixed the component tests, and left an e2e spec red.)
  - Other agents share this machine. Rerun a failure alone before calling it a regression.
  - After any e2e run, kill leftover Electron processes started from this worktree. Never launch a
    packaged app.
- UI work (anything under `src/renderer/` a person sees) follows `.claude/skills/ui-review/SKILL.md`:
  - build to the design spec in your task, using the app's existing classes, primitives and tokens;
  - put every state you built (menus open, a narrow pane, long text, empty, busy, error) in a UI
    scenario under `tests/component/ui/`;
  - run `npm run ui:review -- tests/component/ui/<yours>.ui.test.tsx 2>&1 | tail -40` until the
    audit passes;
  - look at each of your screenshots ONCE, against that skill's review list, and fix what a person
    would notice;
  - list the screenshot files in your report. Never edit the audit, its baselines, or add a
    `data-ui-allow` to get past it.
- The repo's Stop hook checks your whole branch when you try to finish: typecheck, lint, layer rules,
  dead code, architecture tests, the tests you changed, no fewer tests, no src change without a
  test, nothing uncommitted. It keeps blocking until those pass.

Your report (to the path in your task), written ONCE, last, in at most about 40 lines:

- What you built (files) and the design decisions.
- Tests: the commands and the counts you SAW. Never report a pass you did not see.
- A check log: every check that failed on you, what you had written, and what you changed.
- What you left undone, and anything in the docs that misled you.

Write it from your own notes and check log. Do not re-verify facts, re-run suites or re-read files
just for the report, and do not polish it: the lead checks your branch independently. Once your code
is committed and the report exists, you are done. Stop. (An agent once spent over an hour rewriting
its report after its work was finished; the launcher now stops an agent whose report exists and
whose branch has not changed for 15 minutes.)

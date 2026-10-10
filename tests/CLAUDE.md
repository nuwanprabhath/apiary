# Testing

Read with root CLAUDE.md; this is the full version of its "Which layer" summary and the single-test
commands in its "Commands" table. See also [docs/testing.md](../docs/testing.md) for why the
native-module ABI trap this section used to warn about no longer applies.

Four layers (unit, integration, component, e2e), a contract spec shared by two of them and the
architecture tests. A test goes in the cheapest one that can prove what it claims:

- **Unit** (`npm run test:unit`, part of `npm test`, Vitest in Node): pure logic, fully mocked or
  filesystem-only — no real git or pty subprocess, no native module. `tests/unit/purity.test.ts`
  guards the unit/integration split.
- **Integration** (`npm run test:integration`, part of `npm test`): drives a real git or pty
  subprocess, or loads a native module (`better-sqlite3`, `node-pty`). Runs with
  `fileParallelism: false` — several files (worktreeResolver, ptyManager, branchOps, appService)
  drive real subprocesses that contend for the same machine when run concurrently, and a test
  awaiting real git work can overrun its timeout under contention. Serial execution costs about
  13 seconds more than parallel would; that is a fair price for a suite whose green means something.
- **Component** (`npm run test:component`, Vitest browser mode): the whole renderer, mounted as
  `main.tsx` mounts it, in real Chromium with the app's stylesheet, against
  `tests/component/fakeApiary.ts` — an in-memory `ApiaryApi` that models the e2e fixture's four
  sessions and records every call. Real layout and real pointer events (`helpers.ts` has a real
  mouse via a server-side Playwright command), so geometry checks belong here too. About 390 tests.
  A render-count assertion uses `renderTracker.ts` (a React commit counter, inert until used); a
  primitive from `ui/` is mounted alone with `mountUi.tsx`; `renderApp(opts, arrange?)` runs
  `arrange(fake)` before the app mounts, so a test can slow a read at that moment.
  - The fake is typed as `ApiaryApi`: a new IPC call it does not implement is a type error. When
    main starts emitting an event after a call (`treeChanged` after a rename, say), the fake must
    do the same or component tests will pass against behaviour the app does not have.
  - The fake is a model of main, one file per area in `tests/component/fake/` (git, pets, chat,
    themes, update, tabs, settings with plugins and search, sessions), and the contract below checks
    it. Two things hold for every call by construction: a call whose arguments the contract's own
    guard refuses is refused (an invoke rejects, a send is dropped), and what crosses (arguments,
    results, event payloads) is a `structuredClone`, so a component cannot lean on sharing an object
    with the fake's state. A test arranges the world through `renderApp(options)` or `fake.state`;
    a project that is not a repository says `notRepo`, a branch that tracks an upstream is listed in
    `upstream`.
  - `expect.element` on an element not there yet used to overflow the stack printing the whole
    page; `vitest.component.config.ts` sets `DEBUG_PRINT_LIMIT=0` and a 5 s poll for that.
- **UI scenarios** (`tests/component/ui/*.ui.test.tsx`, part of the component run): each opens a state
  of the app and calls `reviewUi`, which runs the UI audit (`tests/component/ui/audit.ts`: clipped, cut-off or
  overlapping elements, see-through popups, unstyled controls, low contrast) at several widths and
  themes and saves screenshots to `ui-review/shots/`. `npm run ui:review` writes them all to
  `ui-review/index.html`. Defects that predate the audit are in `tests/component/ui/knownDefects.allow.json`, which
  only shrinks. See `.claude/skills/ui-review/SKILL.md`.
- **Contract** (`tests/contract/bridgeContract.ts`, no layer of its own): one behavioural spec of
  `window.apiary`, run twice — against `fakeApiary` (`component/contract.test.tsx`) and against the
  real preload plus the real main handlers over an in-process loopback: temp dirs, real git (a
  repository with a worktree and a bare `origin`) and the real services (`integration/contract.test.ts`,
  so it is part of `npm test`). It is what keeps the fake honest: when you change what a call does or
  which event follows it, change the clause, and both sides must pass.
  - The clauses are in `tests/contract/clauses/`, one file per area. `world.ts` is what both sides
    are configured with (the window and its rectangle, two plugins, the update feed); `support.ts`
    has the harness types and `heard`, which records every event the bridge delivers
    (`ctx.heard.count('treeChanged')`). A clause speaks in ids, titles, branch names and counts,
    never absolute paths: a folder is passed back from `bridge.folders`, never looked into.
  - The loopback never reaches the user's `claude`, the network or the OS: chats and new sessions run
    `tests/fixtures/fake-claude-chat.mjs`, the one-shot calls (a pet, a theme) run a script of canned
    replies, the update feed is the fixture backend, and the folder picker, the pet file dialogs and
    the clipboard answer from the harness. What a call cannot cause in it (a teammate's push, a
    commit made in a terminal) is `bridge.outside`.
  - `tests/unit/architecture/contractCoverage.test.ts` fails for a channel no clause exercises, unless
    `contractCoverage.allow.json` exempts it with the reason it cannot run in the loopback (a native
    menu, window chrome, quit time, the GPU, a running claude TUI). It carries no debt, and it does
    not exempt an event the fake emits. A new call starts with a failing clause from
    `npm run new -- ipc <name>`. Shared fixture data lives in `tests/fixtures/standard.ts` (the
    four standard sessions) and git repo builders in `tests/fixtures/gitRepo.ts`; do not hand-roll
    `git init` in a test.
- **Architecture** (`tests/unit/architecture/`, part of `npm run test:unit` and of `npm run lint` as `lint:guards`): fitness functions
  over the source, each with a shrink-only allowlist (`<name>.allow.json`) next to it (a reason on every entry, and
  an entry that matches nothing fails). They cover the `apiary/*` rules themselves
  (`tests/unit/architecture/sanctionedRules.test.ts`), IPC guards and coverage (`looseGuards`, `pathArgs`, `contractCoverage`), the
  composition root (`appServiceDelegates`, `tests/unit/architecture/persistedStores.test.ts`), renderer safety (`errorBoundaries`)
  and repo hygiene (`duplicateSymbols`, `dependencyPlacement`, `cssKeyframes`, `noControlBytes`).
  A failure names the file and the fix; never add to an allowlist to pass. See the "Guard layer"
  section of root `CLAUDE.md`.
- **Generators** (`tests/unit/newGenerator.test.ts`): runs `scripts/new.mjs` into a temp copy of the
  files it edits, so the anchors it relies on cannot drift unnoticed.
- **End-to-end** (`npm run test:e2e`, Playwright + Electron): only what needs the real app —
  processes and ptys, several windows, a relaunch, real git, the watcher, native menus. Every spec
  keeps at least one test proving its feature's real wiring. `npm run test:e2e` always runs
  `npm run build` first (see "Running a single spec" below).
  - Two Playwright projects (`playwright.config.ts`): `parallel` (4 workers, 2 on CI) runs
    everything except tests tagged `@serial`; `serial` (the OS clipboard, window focus, or a
    measurement of timing — things that cannot share the machine) runs afterwards, one at a time,
    and *depends on* `parallel`, so a parallel-project failure skips it.
  - `@smoke` marks a one-minute run through the main paths (`npm run test:e2e:smoke`) — the only
    part of this suite that runs in CI (`ci.yml`'s `e2e-smoke` job); everything else is a
    local/manual gate before tagging a release.
  - `Harness.close()` closes the *current* app (a relaunch replaces `h.app`) and makes sure the
    process has exited, killing and reporting it by test name if not. Closing the first app
    instead once left every relaunched instance running — 26 at once in a full run.
  - No fixed waits: wait on a condition, or use `expectStays(check, ms, what)` to prove something
    does *not* happen. The only `waitForTimeout`s left measure a rate over a window.
  - The same in Vitest: `vi.waitFor` / `expect.poll` for a condition, `nextFrames(n)` and
    `settled(read)` (`tests/component/helpers.ts`) to let React commit or a layout settle, and
    `stays(check, ms, what)` (`tests/fixtures/stays.ts`, the one file `no-test-sleep` allows) to
    prove nothing happens; a fake clock where the test measures time itself.
  - Never write test output to a fixed path; `test.info().outputPath()` lands in `test-results/`.

## Running a single spec

- Unit: `npm test -- tests/unit/x.test.ts` (or `npm run test:unit -- tests/unit/x.test.ts`).
- Integration: `npm run test:integration -- tests/integration/x.test.ts`.
- Component: `npm run test:component -- tests/component/x.test.tsx`.
- E2E: **build first, then run Playwright directly with `--no-deps`.** `npm run test:e2e -- <file>`
  passes `<file>` to Playwright, but Playwright ignores path filters on a project's *dependencies* —
  since `serial` depends on `parallel`, `npm run test:e2e -- tests/e2e/x.spec.ts` still runs the
  **entire** `parallel` project first (as the dependency), then your one test in `serial` if it
  matched, which is not a fast inner loop. Instead:

  ```sh
  npm run build
  npx playwright test tests/e2e/x.spec.ts --project=parallel --no-deps
  # add -g "test title" to narrow further; only safe once `out/` is fresh and the ABI is Electron's
  # (see docs/testing.md — this no longer requires a rebuild, just a build).
  ```

  A test tagged `@serial` needs `--project=serial --no-deps` instead, and runs alone regardless.

## Opt-in suites (spend real resources — never run these by default)

- `APIARY_LIVE_CLAUDE=1 npm run test:e2e -- tests/e2e/live/` — drives a real `claude --model haiku`
  through the built app. Spends real API tokens. See
  [docs/architecture/session-following.md](../docs/architecture/session-following.md).
- `APIARY_BENCH=1 npm run test:e2e -- tests/e2e/bench/` (`APIARY_BENCH_GPU=off` for software
  compositing) — measures theme performance. See
  [src/shared/theme/CLAUDE.md](../src/shared/theme/CLAUDE.md).
- `npm run test:packaged` — packages the app with `electron-builder --dir` (host platform, no
  installers, no publishing) and runs `tests/packaged/` (its own `playwright.packaged.config.ts`)
  against the packaged binary: window, sidebar sessions, a shell that echoes (node-pty from the asar
  unpack), clean quit. `APIARY_E2E_EXECUTABLE` makes the e2e harness launch that binary. On macOS
  it skips unless `codesign --verify --deep --strict` passes. `-- --skip-pack` reuses `release/`.
- `scripts/capture-activity-fixtures.mjs` — records new activity-classifier fixtures against a real
  `claude --model haiku`. Never run in CI. See
  [docs/architecture/activity.md](../docs/architecture/activity.md).
- `APIARY_HEADED=1 npm run test:e2e` — runs e2e with visible windows instead of off-screen, for
  watching a spec run.

## Troubleshooting

If a Playwright launch dies with `Process failed to launch` and `electron does not provide an
export named 'BrowserWindow'`, see [docs/debugging.md](../docs/debugging.md) —
`ELECTRON_RUN_AS_NODE` is almost always the cause.

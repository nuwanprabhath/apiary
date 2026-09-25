# Test suite audit and proposal

A review of Apiary's tests: what they cost, what they catch, what makes them flaky, and how to
make them faster without losing what they prove.

## Status: implemented (branch `fix/test-suite`)

Every proposal below is done. Measured on the same Mac as the numbers that follow:

| | Before | After |
| --- | --- | --- |
| End-to-end | 322 tests, 1 worker, ~14 min | 140 tests (+12 opt-in), 4 workers + 11 serial, **~3.2 min** |
| Component | none | **184 tests, ~20 s**, no Electron — runs in CI on every push |
| Unit / integration | 758 tests | 761 tests (a `forkLabel` unit test, a quit-during-rescan test) |
| Fixed waits in e2e | ~60 | 5, each measuring a rate over a window |
| Smoke run | none | 12 tests, ~23 s (`npm run test:e2e:smoke`) |

182 end-to-end tests moved down, four fewer than classified: one resizes the real Electron window,
one clicks a native scrollbar button (which the browser harness cannot), and some specs kept a
classified test as the one end-to-end test that proves their feature's real wiring.
How the layers work now is in CLAUDE.md, "Testing". What follows is the original proposal, kept
as the record of why.

## Summary

- **The suite is sound but top-heavy.** 757 unit and integration tests run in about 22 seconds.
  322 end-to-end tests take about **15 minutes**, one at a time, each launching the whole Electron
  app from a fresh fixture home.
- **The flakiness had a cause beyond the tests themselves.** Instances of the app outlived their
  tests — up to **26 running at once** in a single run — because the harness closed the app it
  launched first rather than the one a relaunch replaced it with. That is the row of honeycomb
  icons in the Dock, and it loaded the machine for every timing-sensitive test after it. Fixed.
- **58% of the end-to-end tests are testing the renderer**, not the app: tab strips, pickers,
  hover cards, dialogs, CSS geometry. 186 of the 322 could run as component tests in a real
  browser with the `window.apiary` bridge stubbed — no Electron, no git, no fixture home — at a
  fraction of the cost.
- **Proposed end state:** about 130 end-to-end tests run on 4 workers (~3 minutes), about 190
  component tests (~30–60 seconds), unit tests unchanged. Roughly a 4–5× faster full run, with
  the slow layer kept for what only it can prove.

## Fixed already (branch `fix/test-suite`)

| Problem | Cause | Fix |
| --- | --- | --- |
| A row of Apiary icons in the Dock during a run | `Harness.close()` closed the app captured at launch; after `relaunchApiary`, that was an app already closed, and the relaunched one ran until the Playwright worker exited. Up to 26 were alive at once. | `close()` and `newWindow()` use the current `h.app`. A new `closeApp()` waits for the process to actually exit and, if it has not 5s after quitting, reports the test by name and kills it. |
| A Dock icon for every launch, even when nothing leaks | Headless test runs still set a Dock icon | `app.dock.hide()` in headless runs (`APIARY_HEADLESS=1`) |
| Screenshots written to a path on one machine | 12 debug screenshots hard-coded to a Claude scratch folder; on CI or any other machine the write fails | `test.info().outputPath(…)` (lands in `test-results/`, already ignored) |
| A check that never ran | "The shell pane stays pinned to the bottom" compared against `page.viewportSize()`, which is always null for Electron, inside an `if` | Measures `window.innerHeight` and allows exactly `--panel-gap` (fixed in 1.24.1) |

The flaky tests, each reproduced and fixed at its cause:

| Test | Cause | Fix |
| --- | --- | --- |
| "An Active row … keeps its title even when this window's own search excludes it" (1 in 10) | Its "gone from the tree" check matched any text in the sidebar, including the window's own Active row, which appears half a second later. It passed only when it lost that race. | Checks the tree's rows only. 15/15 since. |
| "The search box keeps up with typing, with a realistic number of sessions" (failed every time once the leak fix made the harness wait for the process) | **A real app bug:** quitting waited for the whole rescan in flight, and with 400 folders a rescan takes ~35 s. The app sat invisible for that long after every quit during a big rescan — the test only ever passed because the harness stopped waiting and let it linger. | The rescan stops at its next step once shutdown starts (its results are rebuilt by the next launch anyway). New integration test: quitting mid-rescan takes under half a pass; it fails without the fix. |
| "A session moved into a new window never drops out of Active" | Load: it samples the DOM every 50 ms, and with up to 26 leaked apps running it could miss a frame. | No change needed once the leak was fixed — 10/10. Proposal 4 would make it independent of render timing. |
| The two `appService` integration failures seen once | Not reproduced (60/60 on every run since, including under the e2e run's load). | Left as is; see Proposal 6. |

After the fixes: a full run passes 322/322, with at most 2 app processes alive at once (a relaunch
overlapping its predecessor for a moment) instead of 26.

## Where the suite stands

| Layer | Files | Tests | Time | Runs |
| --- | --- | --- | --- | --- |
| Unit (Vitest, Node) | 56 | ~700 | ~10s | locally, CI on release |
| Integration (Vitest, real git and ptys) | 9 | ~60 | ~12s, serial on purpose | locally, CI on release |
| End-to-end (Playwright + Electron) | 41 | 322 (+12 opt-in) | ~14 min, 1 worker | locally only |

The ten slowest end-to-end files (seconds of test time):

| Spec | Time | Tests |
| --- | --- | --- |
| search | 66 s | 8 |
| sessionTabs | 51 s | 25 |
| composer | 50 s | 5 |
| paneLayouts | 46 s | 20 |
| transcript | 40 s | 11 |
| multiTerminal | 39 s | 16 |
| newSession | 39 s | 12 |
| sidebarPopups | 38 s | 9 |
| gitToolbar | 37 s | 13 |
| terminal | 29 s | 9 |

About 2.8 s per test on average, most of it launching Electron against a freshly built fixture
home (a git repo, a worktree, four sessions) — the fixed cost every end-to-end test pays.

What each end-to-end test really needs, classified test by test (full table in the appendix):

| Needs | Tests | Examples |
| --- | --- | --- |
| The real app: processes, multiple windows, relaunch, git, ptys, the watcher, native menus | 136 | `multiWindow`, `detachTab`, `restoreWindows`, `sessionFollowing`, `newSession`, `pluginBar` |
| Only the renderer: DOM, interaction, CSS/layout — could be a component test | 186 | nearly all of `sessionTabs` (24/25), `paneLayouts` (18/20), `import` (13/16), `update` (13/15), `gitToolbar` (10/13) |
| Pure logic a unit test could cover | a handful | `forkLabel` has no unit test; `update.spec` re-proves the state machine `updateService.test.ts` already covers |

## Proposals

### 1. Run end-to-end tests in parallel — biggest win for least work

Every test already gets its own fixture home and `--user-data-dir`, the app takes no
single-instance lock, opens no fixed port and registers no global shortcut. The blocker was the
leak above, which made parallel runs meaningless (26 apps sharing the CPU). With it fixed:

- `workers: 4` locally (`process.env.CI ? 2 : 4`), `fullyParallel: true`.
- A second Playwright project, `serial`, with `workers: 1`, for the few tests that share
  something machine-wide:
  - the OS clipboard — branch/path copy (`gitToolbar`, `sidebarFolders`, `sessionNotes`) and
    paste (`terminal`, 2 tests);
  - OS focus — `document.hasFocus()` after a cross-window click (`activeSection`);
  - measurements of the machine itself — the typing-under-load test in `search`, and the
    resize-rate tests in `terminal` and `newSession`.
  Tagged `@serial` in the title and routed by `grep`.
- Expected: ~15 min → ~4–5 min on this Mac. Cost: a few hours, mostly re-running until green.
- Risk: CPU contention makes the remaining timing-based waits flakier. Proposal 4 removes most
  of them; until then the `serial` project is where anything timing-sensitive lives.

### 2. Add a component-test layer and move the renderer tests down

Vitest **browser mode** with the Playwright provider runs tests in real Chromium — real CSS,
real layout, real pointer events — which matters here: roughly a third of the renderer tests
measure geometry (`boundingBox`, computed styles), and jsdom cannot lay anything out.

What it needs:

- `vitest.workspace` with a `component` project (`browser: { enabled: true, provider:
  'playwright', instances: [{ browser: 'chromium' }] }`), picking up `tests/component/**`.
- A `renderApp(overrides)` harness that installs a **typed fake of `window.apiary`** — built
  from the `ApiaryApi` type in `src/shared/api.ts`, so a new IPC call that the fake does not
  implement is a type error, not a silent `undefined` — seeded with the same four fixture
  sessions the e2e harness writes, then mounts `<App />` (or a single component) with
  `styles.css` imported.
- Migration by file, biggest first: `sessionTabs`, `paneLayouts`, `import`, `update`,
  `gitToolbar`, `multiTerminal`, `sidebarGroups`, `sidebarPopups`, `transcript`. Each test moves
  with its name unchanged, so the behaviour it states is still findable.
- Each file keeps **one end-to-end smoke test** proving the real wiring (IPC, persistence),
  because a stub can only prove the renderer does the right thing with what the stub says.
- Terminals stay end-to-end: xterm plus a real pty is exactly what the component layer cannot
  fake convincingly.
- Expected: ~190 tests at ~50–200 ms each ≈ 30–60 s, runnable in CI on every push (no Electron,
  no native modules). Cost: the harness is a day; migration is mechanical, file by file.

### 3. Make the slow layer smaller, not only faster

- **`update.spec.ts`** (15 tests, 23 s): the state machine is already proven by
  `tests/integration/updateService.test.ts` with a fake clock. Keep 2–3 end-to-end tests for the
  wiring (banner appears, a click reaches the service, a setting persists) and move the copy and
  button checks to component tests.
- **`forkLabel`**: add the unit test it lacks; the two fork e2e tests become one.
- **`gitMenu.spec.ts`** opens a real shell in `beforeEach` for all six tests; only the two that
  merge need git at all.

### 4. Replace fixed waits with conditions

About 60 `waitForTimeout` calls remain, each now carrying a reason. They fall into three kinds:

| Kind | Example | Better |
| --- | --- | --- |
| Waiting for something with a visible sign | "let the scroll settle" | a web-first assertion or `expect.poll` on that sign |
| Proving something does *not* happen | "the folder does not re-expand" | one helper, `expectStays(check, ms)`, polling the check for the whole window and failing on the first change — explicit about what it proves |
| Debounces in the app | layout report (500 ms), watcher rescan | expose the debounce through a test hook (the app already has `APIARY_FAKE_UPDATE`-style switches) or wait on the IPC the debounce ends in, as `countPtyResizeCalls` already does |

The sampling test in `detachTab` ("never drops out of Active") is legitimate — it samples
because the bug was a flicker — but it should sample the registry in the main process (via
`app.evaluate`) rather than the DOM, so a slow render cannot look like a dropped row.

### 5. Run what is fast in CI

CI runs typecheck, lint and the unit suite, only when a release is tagged. Proposed:

- `ci.yml` (added with the lint work) also runs the unit/integration suite on every push — it
  needs `npm ci` with scripts, for the native modules.
- The component layer (Proposal 2) runs there too: headless Chromium, no Electron.
- End-to-end stays a local gate before tagging, as CLAUDE.md says — it needs a display on Linux
  and a real `claude` for the live specs. A later step could run it on Linux under `xvfb-run` in
  two shards.

### 6. Smaller things

- **A smoke subset.** Tag ~15 tests `@smoke` (boot, open a session, resume, a terminal, a split,
  settings, a theme) for a one-minute confidence run before a push.
- **Integration tests stay serial.** `fileParallelism: false` costs ~13 s and was chosen after
  measured timeouts under contention; not worth revisiting.
- **The two `appService` integration failures seen once** under load: both drive a real pty
  with bounded waits; if they recur, the fix is the same as Proposal 4 — wait on the output, not
  on the clock.

## Suggested order

1. Merge `fix/test-suite` (leak, Dock, paths, flaky fixes). *Done, pending review.*
2. Parallel workers with a `serial` project (Proposal 1). *Half a day.*
3. Component harness plus the first two files, `sessionTabs` and `paneLayouts` (Proposal 2).
   *A day or two.* Then the rest, file by file, alongside other work.
4. Trim `update`, `gitMenu`, add the `forkLabel` unit test (Proposal 3). *An hour or two.*
5. Replace fixed waits, file by file, as each is touched (Proposal 4).
6. CI additions (Proposal 5).

## Appendix: per-file classification

`E2E` needs the real app; `Comp` could be a component test. From a test-by-test read of every
spec (excluding the opt-in `live/` and `bench/`).

| Spec | Tests | E2E | Comp | Notes |
| --- | --- | --- | --- | --- |
| sessionTabs | 25 | 1 | 24 | only the pane-swap test needs a real pty |
| paneLayouts | 20 | 2 | 18 | layout logic already unit-tested in `layout.test.ts` |
| import | 16 | 3 | 13 | watcher, rescan race, relaunch stay |
| multiTerminal | 16 | 5 | 11 | real pty output and relaunch stay |
| update | 15 | 2 | 13 | state machine duplicated by `updateService.test.ts` |
| gitToolbar | 13 | 3 | 10 | real remote, clipboard stay |
| newSession | 12 | 11 | 1 | real ptys throughout |
| sidebar | 11 | 5 | 6 | relaunch and scan stay |
| sidebarGroups | 11 | 3 | 8 | persistence across relaunch stays |
| themes | 11 | 7 | 4 | native menu, second window, relaunch stay |
| transcript | 11 | 3 | 8 | held-IPC paging races stay |
| pluginBar | 10 | 8 | 2 | spawns the stand-in `glab` |
| sessionNotes | 10 | 4 | 6 | FTS index, relaunch, clipboard stay |
| detachTab | 9 | 9 | 0 | multiple windows |
| sidebarPopups | 9 | 1 | 8 | pointer-path tests need a real browser, not Electron |
| terminal | 9 | 7 | 2 | ptys, clipboard |
| search | 8 | 4 | 4 | FTS index stays |
| settings | 8 | 3 | 5 | persistence and rescan stay |
| sidebarFolders | 8 | 4 | 4 | clipboard, native menu, git pull stay |
| activeSection | 7 | 4 | 3 | multiple windows, focus |
| lookAndFeel | 7 | 1 | 6 | the cursor test reads Electron's `cursor-changed` |
| multiWindow | 7 | 7 | 0 | multiple windows |
| uiPolish | 7 | 3 | 4 | watcher tests stay |
| gitMenu | 6 | 2 | 4 | real merges stay |
| pinning | 6 | 2 | 4 | persistence stays |
| composer | 5 | 3 | 2 | pty delivery stays |
| themeGenerator | 5 | 5 | 0 | spawns the stand-in generator |
| the other 14 files | 40 | 24 | 16 | mostly single-feature specs of 1–4 tests |
| **Total** | **322** | **136** | **186** | |

Tests that must stay serial under parallel workers: the clipboard tests (6), the focus test in
`activeSection` (1), and the three that measure the machine (`search` typing under load,
`terminal` and `newSession` resize rates).

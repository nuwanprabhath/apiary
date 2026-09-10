# Settings page, import dialog, modal stacking, empty columns — progress tracker

Released as **1.6.0**. Items numbered as the user listed them.

## Status

| # | Item | State |
|---|------|-------|
| 1 | Merge-branch popup looks transparent | **done** |
| 2 | Import popup: Escape, drag-to-widen, hover tooltips, select-all | **done** |
| 3 | Extensible settings page + session auto-import settings | **done** |
| 4 | Empty side column while clicking through split view | **done** |

## Root causes

**#1 — not transparency at all.** `.modal-backdrop` carried no `z-index`. A modal is rendered
inside whichever session column opened it, and later sibling columns contain positioned boxes of
their own (`.centre-pane`, `.pane-fill`), so a dialog opened from column 1 was painted *over* by
column 2's transcript. Now `z-index: 80` — above the git menu (60), below notifications (100),
because a failure raised while a dialog is open still has to be readable over it. The regression
test samples `elementFromPoint` down the dialog's right-hand edge and asserts the dialog owns
every hit.

**#4.** Several routes close a tab, and each was individually responsible for dropping the column
if that emptied it. The route behind a pending session's pty exiting did not. Added `pruneColumns`
and routed *every* `setColumns` through it, so the invariant — an empty column exists only when it
is the only one — cannot be forgotten. Also gave `.session-column` a `min-width` so it can't be
squeezed to a sliver.

**#3.** Settings is now a nav + pane driven by a `SECTIONS` array. Main-process behaviour:
`autoImportAll` is applied inside `runRefresh()` rather than at its callers, so the Refresh button,
the file watcher and the periodic timer all honour it — a setting called "import everything
automatically" that held for only some of those routes would be the worst kind of half-true. The
periodic timer re-arms after each run rather than using a fixed `setInterval`, so a slow scan can't
have the next one stacked behind it, and is cleared before `dispose()` so it can't fire against a
closed store. `importAllDiscovered` deliberately does *not* set the per-project auto-import flag:
that flag is a standing instruction about one folder chosen in the dialog, while this is a global
switch that can be turned off again.

## Two traps worth remembering

**A green suite that isn't.** `npm test` once reported 3 files / 20 tests failing with the suite
taking 677s instead of ~11s. Nothing was wrong: that run coincided with the machine running out of
memory (it took VS Code down too), and every "failure" was a timeout. Re-run on a healthy machine:
154/154 in ~5s. The subagent that wrote the code also reported these as "pre-existing timeouts",
which was wrong in its reasoning — the suite was green at `f4e4b2d`. Verify such claims either way.

**Hover-revealed buttons are a flaky-test generator.** The sidebar row actions are `display: none`
until hover. Retrying only the *click* cannot work: anything that re-renders the sidebar between
the hover and the click replaces the row's DOM and takes the hover with it, leaving the click
waiting on a node that will never become visible. `clickRowAction()` in helpers.ts now retries the
hover and the click *together* via `expect(...).toPass()`. This was a genuine 1-in-5 flake.

**A moved settings field breaks its test helper.** `newSession.spec.ts` fills `claude-bin-input`
directly; that field now lives under the General section, which is not the default. The helper
clicks `settings-nav-general` first. The failure was correct — the UI genuinely changed.

## Environment gotchas (bite every time)

- `ELECTRON_RUN_AS_NODE=1` is exported here and breaks every Electron launch:
  `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`.
- `npm test` rebuilds native modules for **Node's** ABI; e2e and `npm start` need **Electron's**.
  Whichever ran last wins — `npm run rebuild:electron` before any Playwright run, and use
  `npm test` (not bare `npx vitest run`) after one.
- `npx playwright test` does not rebuild; `npm run build` first.

Final state: typecheck clean, `npm test` 154 passed, e2e 116 passed.

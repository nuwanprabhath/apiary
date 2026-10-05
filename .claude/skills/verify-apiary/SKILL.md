---
name: verify-apiary
description: Drive the real, built Apiary Electron app the way a user does and capture proof (screenshots plus measured state) in an isolated, off-screen instance. Use to confirm a UI or behaviour change works in the real app rather than only in tests, to look at how something renders, or when asked to "check it in the app", "take a screenshot", or "verify". Never touches the maintainer's own Apiary.
---

# Verify Apiary in the real app

Tests prove what they assert. This proves what a user would see. Use it after a change to the
renderer, a worker, CSS, IPC wiring or anything visual, and before saying "it works".

Everything here goes through `launchApiary` (`tests/e2e/helpers.ts`), the same harness as the e2e
suite: a throwaway home with four fixture sessions across three projects (one a git repo with a
worktree), its own `--user-data-dir`, a stand-in `claude`, an isolated git identity, and the window
kept off-screen. Nothing reads or writes the maintainer's `~/Library/Application Support/Apiary`.

## Rules

- Off-screen by default. Pass `--headed` only when the maintainer asks to watch: windows that
  appear on their screen while they work are the complaint this rule exists for.
- Never launch the packaged `Apiary.app` from here. If a packaged build must be checked, use
  `npm run test:packaged`, which refuses to launch unless `codesign --verify` passes.
- Never kill Electron by name. `verify.sh cleanup` only touches processes whose
  `--user-data-dir` sits under an `apiary-e2e-` temp home, which only the harness creates.
- A stand-in `claude` answers every Claude call. Never point a drive at the real `claude` unless
  the maintainer asks, since that spends tokens (`claudeBin: null` does it).

## Launch, doctor, drive, clean up

All from the repo root:

```sh
.claude/skills/verify-apiary/verify.sh doctor          # first, and again after anything surprising
.claude/skills/verify-apiary/verify.sh run pets        # a shipped drive
.claude/skills/verify-apiary/verify.sh run my-check    # your own, in drives/local/my-check.verify.ts
.claude/skills/verify-apiary/verify.sh cleanup         # list strays; --kill kills ones up >10 min
```

- `run` builds first when any file in `src/` is newer than `out/main/index.js` (`--no-build`
  skips that). A stale `out/` is the usual reason a drive "proves" old behaviour. `doctor` checks
  the running app's version matches `package.json` for the same reason.
- The app is ready when `getByTestId('sidebar')` is visible. Each drive closes its own app in a
  `finally`; `h.close()` waits for the process to exit and SIGKILLs it after 5 s.
- `doctor` is the health check: Node ≥ 22, `node_modules` present, strays reported, then a boot
  that checks the version and that the sidebar lists the 4 fixture sessions after an import.

## Writing a drive

A drive is a Playwright test file named `*.verify.ts`. Put throwaway ones in `drives/local/`
(gitignored). Promote one to `drives/` when it covers a feature in the map below and is worth
rerunning. Skeleton:

```ts
import { test, expect } from '@playwright/test'
import { launchApiary, importAll } from '../../../../../tests/e2e/helpers' // one less ../ in drives/
import { note, shot } from '../lib'

test('what this proves', async () => {
  const h = await launchApiary({ realDefaultTheme: true }) // the theme a new install gets
  try {
    await importAll(h.page)
    await h.page.getByTestId('sidebar-refresh').click()
    // drive it like a user: clicks, typing, drag with h.page.mouse
    note('measured', { box: await h.page.getByTestId('content').boundingBox() })
    await shot(h.page, 'after')
  } finally {
    await h.close()
  }
})
```

Useful `launchApiary` options (full list and why each exists: `tests/e2e/helpers.ts`):
`realDefaultTheme` (Liquid Glass instead of the suite's original look), `windowChrome: 'custom'`
(the Windows/Linux title bar on any OS), `settings` (seed settings), `claudeBin` (your own
stand-in), `fakeLiveSessionId` (a session shown as running), `extraSessions`,
`fakeUpdate`, `electronArgs`. To reach state the UI only reads at startup, write it into the
profile and `relaunchApiary(h)`: `scripts/screenshot/screenshot.spec.ts` does this with
`pets.json`. Settings opens through the main process:
`h.app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog') })`.

Prefer `getByTestId` handles; the feature files list the real ones. Read main-process state with
`h.app.evaluate`, and on-disk state from the profile (`app.getPath('userData')`).

## Evidence

Each run writes to `.verify/evidence/<timestamp>-<drive>/` (gitignored), and `verify.sh` prints
the path. `shot(page, name, clip?)` saves a PNG; `note(name, data)` saves JSON. Look at the
screenshots with the Read tool before claiming anything about how something looks.

What counts as proof:

- The real user path: clicks and typing, not `window.apiary` calls or internal setters. Seeding a
  profile file is fine for setup, not for the step being proven.
- The action and the resulting state, not only the final screen: a screenshot plus the measured
  numbers (`boundingBox`, attributes, file contents) that make it true.
- Side effects next to what is visible: the file written in userData, the row in `apiary.db`
  (read it with `sqlite3 -readonly`, see `docs/debugging.md`).
- Stand-ins only where a production boundary already isolates the outside world: `claude`,
  `glab`, `code`, the updater feed, native dialogs (the `APIARY_*` hooks in `docs/environment.md`).

Cleanup never deletes `.verify/evidence/`. Clear it by hand when it gets large.

## Feature map

[`features/README.md`](features/README.md) indexes one file per user-facing feature: how a user
reaches it, how to drive it here, and what end state proves it works. A proof that drives one
convenient entry point is incomplete when the map lists others.

## Keeping the map honest

The map rots as the app changes. When asked to audit it, or after a change that renames test ids
or moves a feature:

1. Check the index against the files in `features/`. Fix missing, extra or dead entries.
2. For each feature file, read the source it points at and note drift with a `file:line`.
3. Drive every feature live at least once, `doctor` first and again after any failed drive.
4. Sort what you find: a wrong description is map drift (fix the map); behaviour the harness
   cannot reach is a harness gap (fix `verify.sh`, `lib.ts` or a drive); behaviour that is broken
   is a product bug (report it to the maintainer, do not paper over it in the map).
5. Edit only this skill's directory during an audit. Ship corrections as one commit.

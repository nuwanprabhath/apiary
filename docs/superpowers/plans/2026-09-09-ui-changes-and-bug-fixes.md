# UI changes and bug fixes — progress tracker

Branch: `feat-ui-changes-and-bug-fixes`. Delivery: **all 12 items in one release**, then
version bump + merge to main + tag.

Decisions taken with the user up front:
- Item 5 splits: **unlimited columns**, each column is a VS Code-style editor group with its
  own tab bar; **each column gets its own shell pane** beneath it.
- Item 12 icon: **white full-bleed** macOS icon (macOS 26 force-masks packaged icons onto a
  tile, which is the grey background being seen; dev mode bypasses that, which is why
  `npm start` looks right).

## Status

| # | Item | State |
|---|------|-------|
| 1 | Ubuntu 24.04 chrome-sandbox SUID abort | **done** |
| 2 | Import dialog: collapsible sections | **done** |
| 3 | "+" terminal opens the side panel automatically | **done** |
| 4 | Search clear button, rename-input border, theme tokens | **done** |
| 5 | Session tab bar + split editor + per-column shell | **done** (needs full e2e pass) |
| 6 | Transcript live-updates + opens scrolled to bottom | **done** |
| 7 | Shell pane fixed, not scrollable | **done** |
| 8 | Hide-shell chevron direction + shell sometimes not appearing | **done** |
| 9 | Terminal scrolls to bottom when switched to | **done** |
| 10 | Branch name stale after switching branch in the terminal | **done** |
| 11 | Terminal scrollback lost when switching *sessions* | **done** (also fixed for hide/show shell) |
| 12 | macOS icon grey background | **done** |

## Notes / root causes found

- **1**: electron-builder's stock `after-install.tpl` only `chmod 4755`s `chrome-sandbox` when
  user namespaces are *unavailable*, tested as root at install time. On Ubuntu 24.04 root can
  use userns, so it takes the `chmod 0755` branch — but at runtime the unprivileged user is
  blocked by AppArmor (`kernel.apparmor_restrict_unprivileged_userns=1`), so Electron falls
  back to the SUID helper, finds it non-SUID, and aborts. Fix: ship a custom afterInstall.
- **8**: `shell-toggle` uses a hardcoded `▾` glyph that never rotates (App.tsx).
- **11**: the v1.1.0 "keep tabs mounted" fix only keeps tabs of the *current* session mounted;
  `currentTabs` is keyed by `shellKey`, so switching session unmounts the other session's
  terminals and loses their xterm scrollback.

## Implementation notes (second batch)

- **5**: `state/columns.ts` holds the editor-group model; `SessionColumn.tsx` is one group (tab
  strip + session + its own shell); `SessionTabBar.tsx` is the strip. App.tsx keeps only the
  cross-column state. Shell terminals stay keyed globally by session, not per column, so two
  columns showing the same session share one set of terminals instead of spawning
  `shell:<key>:1` twice and killing each other's shell.
- **8**: the "shell won't come up" half was a dead pty still being listed — exiting a shell left
  its tab behind pointing at a corpse, so reopening showed a terminal that could never print
  again. `onPtyExit` now prunes the tab, so the next open spawns a fresh shell.
- **10**: the branch label is re-read on a 5s timer (skipped entirely while the window is
  unfocused) plus on window focus. Nothing about `git checkout` typed into the terminal is
  observable from the renderer otherwise.
- **11**: every open tab's terminals stay mounted (hidden) rather than only the active session's,
  so scrollback survives switching session as well as switching terminal.
- Testing note: `npx playwright test` does **not** rebuild — `ELECTRON_RUN_AS_NODE=1` also leaks
  from this harness's env and makes Electron run as node. Use
  `env -u ELECTRON_RUN_AS_NODE npm run test:e2e`.

- **11 (second half)**: collapsing the shell pane also unmounted every terminal in it, so hide +
  reshow threw the scrollback away just as switching session did. Terminals now stay mounted and
  merely hidden; a hidden terminal has no box for FitAddon to measure, so its pty is never resized
  while collapsed either.

## Verification

- 140 unit/integration tests, 76 e2e tests, typecheck clean.
- New e2e: `sessionTabs.spec.ts` (tabs, split, no cap, pinned shell pane), `uiPolish.spec.ts`
  (search clear, import collapse, transcript live-update + opens at bottom), plus additions to
  `multiTerminal.spec.ts`.
- Layout screenshotted and eyeballed with two columns open, each with its own tab strip and shell.

import { test, expect, type Page, type Locator } from '@playwright/test'
import { writeFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
import {
  launchApiary, importAll, relaunchApiary, countPtyResizeCalls, ptyResizeCallCount, type Harness,
} from './helpers'
import { makeSession } from '../fixtures/makeSession'

let h: Harness

/**
 * Points `claudeBin` at a throwaway script that just execs the login shell, exactly like
 * `PtyManager`'s bottom-shell spawn does. A brand-new session has no interactive control over
 * the real `claude` CLI (its first-run "trust this folder" prompt repaints continuously, and
 * typed input goes to Claude's own prompt box, not a shell) — a shell stand-in is the only way
 * to prove *which directory the process actually launched in* by typing a command and reading
 * its output, the same technique the existing bottom-shell spec uses. This is exercised through
 * the real `claudeBin` setting (see settings.spec.ts), not a code path invented for the test.
 */
async function useFakeClaudeShell(h: Harness): Promise<void> {
  const script = join(h.home, 'fake-claude.sh')
  writeFileSync(script, '#!/bin/sh\nexec "$SHELL" -l\n')
  chmodSync(script, 0o755)

  await h.app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-settings-dialog')
  })
  await h.page.getByTestId('claude-bin-input').fill(script)
  await h.page.getByTestId('settings-save').click()
  await expect(h.page.getByTestId('settings-dialog')).toHaveCount(0)
}

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await useFakeClaudeShell(h)
})
test.afterEach(async () => { await h.close() })

/** Same scoping trick sidebar.spec.ts uses: the project-group `<li>` whose OWN toggle carries
 *  this label, not one belonging to a nested worktree group further down the same subtree. */
function groupLabelled(page: Page, label: string): Locator {
  return page.locator(
    `li[data-testid="project-group"]:has(> div > button[data-testid="project-toggle"] .project-label:text-is("${label}"))`,
  )
}

test('the "+" button spawns a terminal running in that folder', async () => {
  const workA = groupLabelled(h.page, 'work-a')
  await workA.getByTestId('new-session-button').click()

  await expect(h.page.getByTestId('terminal-session')).toBeVisible()
  await expect(h.page.getByTestId('session-title')).toContainText('New session')

  // The prompt is shell-dependent, so assert on output we command ourselves — same pattern the
  // bottom-shell spec uses to prove *which* directory a terminal actually launched in.
  await h.page.getByTestId('terminal-session').click({ force: true })
  await h.page.keyboard.type('echo APIARY_NEW_$(basename "$PWD")\n')
  await expect(h.page.getByTestId('terminal-session')).toContainText('APIARY_NEW_work-a', {
    timeout: 20000,
  })
})

// Regression test for a `fit()`/`ResizeObserver` feedback loop in `TerminalView`: centre-pane
// used to have no `overflow: hidden`, so a sub-pixel rounding overflow from xterm's own render
// could bleed up into `.content`'s `overflow: auto`, toggling a scrollbar on and off and
// oscillating the terminal host's measured size between two states forever. Each oscillation
// called `ptyResize`, and Claude Code's TUI repainted its prompt at the two alternating row
// counts fast enough to look like a flickering duplicate input line to the eye, while a single
// screenshot only ever caught one frame of it. `ptyResize` is the real signal (not terminal
// *content*, which a TUI can repaint identically at either size): this asserts the call count
// reaches a steady state after the terminal settles, which fails against the oscillation (it
// called `ptyResize` continuously, dozens of times a second, with no settling point).
test('resizing the new-session terminal settles instead of oscillating', async () => {
  await countPtyResizeCalls(h.app)

  const workA = groupLabelled(h.page, 'work-a')
  await workA.getByTestId('new-session-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()

  // Give layout (and, if the bug were present, several oscillation cycles) time to settle.
  await h.page.waitForTimeout(1500)
  const afterSettle = await ptyResizeCallCount(h.app)

  // If the loop were still present, this window alone would rack up dozens more calls (an
  // observed ~60/second in the failure this test guards against). A stable layout adds at most
  // a handful from legitimate one-off layout settling, never an unbounded stream.
  await h.page.waitForTimeout(1500)
  const afterQuietWindow = await ptyResizeCallCount(h.app)

  expect(afterQuietWindow - afterSettle).toBeLessThan(5)
})

test('clicking "+" does not toggle the folder\'s expand/collapse state', async () => {
  const workA = groupLabelled(h.page, 'work-a')
  const toggle = workA.getByTestId('project-toggle')

  // Starts expanded (default): its session is visible.
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(workA.getByText('Fix CSV export bug')).toBeVisible()

  await workA.getByTestId('new-session-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()

  // Still expanded, and the pre-existing session row is still there — the click did not
  // collapse it (nor did it toggle some unrelated group).
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(workA.getByText('Fix CSV export bug')).toBeVisible()

  // Now collapse it by hand, then click "+" again — it must stay collapsed too, proving the
  // handler never touches expand/collapse state in either direction.
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await workA.getByTestId('new-session-button').click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('File > New Session in Folder... exists and starts a session in the picked folder', async () => {
  // A real native folder picker cannot be driven from Playwright, so the picker itself is
  // stubbed in the main process — this proves the menu item exists, is wired to the
  // `apiary:new-session-started` channel, and that the folder it receives (not some other path)
  // is what the new session actually launches in. What this cannot cover: the real OS dialog UI.
  await h.app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [folder] })) as typeof dialog.showOpenDialog
  }, h.workdirB)

  const found = await h.app.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('new-session-in-folder')
    return item !== null && item !== undefined
  })
  expect(found).toBe(true)

  await h.app.evaluate(({ Menu, BrowserWindow }) => {
    const item = Menu.getApplicationMenu()?.getMenuItemById('new-session-in-folder')
    const win = BrowserWindow.getAllWindows()[0]
    item?.click(item, win, {} as never)
  })

  await expect(h.page.getByTestId('terminal-session')).toBeVisible()
  await expect(h.page.getByTestId('session-title')).toContainText('New session')

  await h.page.getByTestId('terminal-session').click({ force: true })
  await h.page.keyboard.type('echo APIARY_NEW_$(basename "$PWD")\n')
  await expect(h.page.getByTestId('terminal-session')).toContainText('APIARY_NEW_work-b', {
    timeout: 20000,
  })
})

// A pending (not-yet-resolved) new session previously had no bottom shell pane at all — the
// terminal filled the whole content area right down to the window edge, and there was no way to
// open a plain shell in that same folder until the session had resolved into a real one. The
// shell toggle now shows for a pending session too, spawning via `openShellForPty` (the pty has
// no session id yet) rather than `openShell`.
test('a pending new session also offers a shell toggle in the same folder', async () => {
  const workA = groupLabelled(h.page, 'work-a')
  await workA.getByTestId('new-session-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()

  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()

  await h.page.getByTestId('terminal-shell').click({ force: true })
  await h.page.keyboard.type('echo APIARY_PENDING_SHELL_$(basename "$PWD")\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_PENDING_SHELL_work-a', {
    timeout: 20000,
  })
})

// Regression test for a FitAddon/padding mismatch: `.terminal-host`'s own CSS padding is invisible
// to FitAddon.proposeDimensions(), which only ever subtracts the padding of `terminal.element`
// (the "terminal xterm" div xterm creates one level in) from `.terminal-host`'s own box height —
// never `.terminal-host`'s own padding. Padding placed on `.terminal-host` therefore made FitAddon
// propose one row too many for the space actually left after that padding ate into the box, and
// the newly-spawned shell's very first prompt line — with nothing else on screen yet to push it
// into view — landed in that now-invisible last row, clipped by `.terminal-host`'s
// `overflow: hidden`, and reading as a shell that never visibly started at all. Asserted without
// any click/typing, which (by forcing a resize/refit as a side effect) could otherwise mask
// exactly this failure.
test('opening a pending session\'s shell shows its prompt immediately, without needing to interact with it first', async () => {
  const workA = groupLabelled(h.page, 'work-a')
  await workA.getByTestId('new-session-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()

  await h.page.getByTestId('shell-toggle').click()
  const shell = h.page.getByTestId('terminal-shell')
  await expect(shell).toBeVisible()
  await expect(shell).not.toBeEmpty({ timeout: 10000 })
})

// Finding 1 (Critical): a second "+" click before the first pending session resolves used to
// overwrite the single `pending` value in App.tsx, orphaning the first pty — fully detached, no
// visible tab, never reachable again. `pending` is now keyed by pty id (a Map), and the sidebar
// surfaces every unresolved one so an older pending session can be switched back to and proven
// alive, not just avoided-from-crashing. This is the regression test for that fix; reverting
// `pending` to a single `useState<PendingSession | null>` makes it fail (see report for the
// mutation evidence).
test('starting a second new session before the first resolves does not orphan the first pty', async () => {
  const workA = groupLabelled(h.page, 'work-a')
  const workB = groupLabelled(h.page, 'work-b')

  // Fire both starts back to back, without waiting for the first to settle — the exact sequence
  // Finding 1 describes (impatient double-click, here across two different folders).
  await workA.getByTestId('new-session-button').click()
  await workB.getByTestId('new-session-button').click()

  // The most recently started pending session (work-b) is the one shown in the main pane. Wait
  // for the swap to settle on work-b's cwd — the terminal element itself is re-used at the same
  // DOM position (see Finding 2), but the xterm instance behind it was just torn down and
  // recreated for the new pty, so typing into it before that finishes lands nowhere.
  await expect(h.page.locator('.session-cwd')).toHaveText(h.workdirB)
  await h.page.getByTestId('terminal-session').click({ force: true })
  await expect(h.page.getByTestId('terminal-session')).toContainText('$', { timeout: 20000 })
  await h.page.keyboard.type('echo APIARY_NEW_$(basename "$PWD")\n')
  await expect(h.page.getByTestId('terminal-session')).toContainText('APIARY_NEW_work-b', {
    timeout: 20000,
  })

  // ...while the first (work-a) is still tracked, not silently dropped: it is listed as a
  // reachable pending session in the sidebar rather than having vanished with no visible tab.
  const pendingItems = h.page.getByTestId('pending-session-item')
  await expect(pendingItems).toHaveCount(1)
  await expect(pendingItems.first()).toContainText('work-a')

  // Switching back to it proves its pty is still alive and reachable — not orphaned — by typing
  // into it directly and reading real output back, the same technique used above for work-b.
  await pendingItems.first().click()
  await expect(h.page.locator('.session-cwd')).toHaveText(h.workdir)
  await h.page.getByTestId('terminal-session').click({ force: true })
  await expect(h.page.getByTestId('terminal-session')).toContainText('$', { timeout: 20000 })
  await h.page.keyboard.type('echo APIARY_NEW_$(basename "$PWD")\n')
  await expect(h.page.getByTestId('terminal-session')).toContainText('APIARY_NEW_work-a', {
    timeout: 20000,
  })

  // And work-b, which we navigated away from, is still there too (not orphaned by the switch
  // back to work-a either) — proving both survive concurrently.
  await expect(h.page.getByTestId('pending-session-item')).toHaveCount(1)
  await expect(h.page.getByTestId('pending-session-item').first()).toContainText('work-b')
})

// Finding 2 (Important): reconciliation used to render the pending terminal and the
// resumed-session terminal as structurally different JSX branches, so React unmounted and
// remounted TerminalView the moment the watcher matched the pending pty to its real session id —
// discarding all scrollback, including anything printed during the pending phase. The terminal
// pane is now a single persistent mount across that transition.
//
// The fake-claude-shell stand-in never writes a Claude JSONL, so it never reconciles into a real
// SessionNode on its own — this test drives that transition directly via `newSessionInProject`'s
// pty id, matching exactly what the reconciliation effect does when Claude's own JSONL appears,
// without depending on a real `claude` binary.
test('reconciling a pending session into its real SessionNode keeps prior terminal output on screen', async () => {
  const workA = groupLabelled(h.page, 'work-a')
  await workA.getByTestId('new-session-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()

  // Write a marker into the pending terminal — this is our own echoed input, not CLI-repainted
  // content, so (per the task notes) it is a stable, non-flaky thing to look for after reconciliation.
  await h.page.getByTestId('terminal-session').click({ force: true })
  await h.page.keyboard.type('echo PENDING_MARKER_survives\n')
  await expect(h.page.getByTestId('terminal-session')).toContainText('PENDING_MARKER_survives', {
    timeout: 20000,
  })

  // Drive the exact same fold-into-a-real-session path the JSONL watcher drives, using a fixture
  // session written directly to disk in the same folder (work-a already has one fixture session
  // there too, from launchApiary — proving the cwd match correctly excludes it as "not new") — the
  // app's own file watcher / treeChanged reconciliation effect then matches the new one to the
  // pending pty by cwd, exactly as it would for a real `claude` process's first JSONL write.
  makeSession(h.projectsRoot, '-work-a-reconciled', {
    sessionId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    cwd: h.workdir,
    title: 'Reconciled marker session',
  })

  // Wait for the watcher's debounced rescan (chokidar stabilityThreshold 500ms + 1s debounce in
  // main/ipc.ts) to pick the new JSONL up and for reconciliation to fold it in.
  await expect(h.page.getByTestId('session-title')).toContainText('Reconciled marker session', {
    timeout: 15000,
  })

  // The critical assertion: the marker echoed before reconciliation is still visible — the
  // terminal was never unmounted, so xterm's scrollback was never dropped.
  await expect(h.page.getByTestId('terminal-session')).toContainText('PENDING_MARKER_survives')
})

// A pending session has no session id yet, so a rename typed in before Claude ever writes its
// JSONL has nowhere in the store to persist against. It's held in-memory
// (PendingSession.titleOverride) and applied via renameSession the moment reconciliation finds
// the real session id — this proves that round trip end to end, including that it survives a
// relaunch (i.e. it really landed in the store, not just optimistic renderer state).
test('a rename typed in while a session is still pending applies once it resolves into a real one', async () => {
  const workA = groupLabelled(h.page, 'work-a')
  await workA.getByTestId('new-session-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()

  await h.page.getByTestId('session-title-edit').click()
  await h.page.getByTestId('session-title-input').fill('Renamed before it existed')
  await h.page.getByTestId('session-title-input').press('Enter')
  await expect(h.page.getByTestId('session-title')).toContainText('Renamed before it existed')

  makeSession(h.projectsRoot, '-work-a-pending-rename', {
    sessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    cwd: h.workdir,
    title: 'Whatever Claude itself would have called it',
  })

  // Once reconciled, the header shows the rename, not the scanner's own title.
  await expect(h.page.getByTestId('session-title')).toHaveText('Renamed before it existed', {
    timeout: 15000,
  })
  await expect(h.page.getByTestId('session-title')).not.toContainText('Whatever Claude')

  // And it is a real store write, not just optimistic state left over from the pending phase.
  await relaunchApiary(h)
  await expect(h.page.getByTestId('session-title')).toHaveText('Renamed before it existed')
})

import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  launchApiary, importAll, sidebarSession, relaunchApiary, relaunchApiaryViaWindowClose, type Harness,
} from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('a split with two tabs returns after relaunch, same preset and active tab', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  // Splitting focuses the new pane (see paneLayouts.spec.ts), and copies the active tab into it
  // (per CLAUDE.md: "splitting copies") — so the new pane starts with "Fix CSV export bug" too,
  // before "Add worktree switcher" is opened in it as a second tab.
  await h.page.getByTestId('session-tab-split').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(2)
  await expect(h.page.getByTestId('session-tab')).toHaveCount(3)

  await relaunchApiary(h)

  await expect(h.page.getByTestId('session-column')).toHaveCount(2)
  await expect(h.page.getByTestId('session-tab')).toHaveCount(3)
  // The last pane is the one the split opened, showing whichever session was active there.
  await expect(h.page.getByTestId('session-title').last()).toHaveText('Add worktree switcher')
})

test('the layout returns after quitting by closing the last window, not just via Cmd+Q', async () => {
  // The X button is the ordinary way to quit on Linux, and it is the one path `electronApp.close()`
  // never takes: Electron runs the window's own `closed` handler first, which used to delete the
  // window's stored record, so the flush in `before-quit` wrote an empty file and every quit
  // silently discarded the whole saved layout.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('session-tab-split').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('session-column')).toHaveCount(2)
  await expect(h.page.getByTestId('session-tab')).toHaveCount(3)

  // The layout has to have reached the store before the quit, or this would be testing the
  // renderer's 500ms report debounce rather than what the quit does with what was reported. The
  // file on disk is the store's own signal that it has heard about the split.
  const layoutFile = join(h.home, 'userdata', 'session-layout.json')
  await expect.poll(() => {
    try {
      const data = JSON.parse(readFileSync(layoutFile, 'utf8')) as
        { windows: { layout: { panes: unknown[] } }[] }
      return data.windows[0]?.layout.panes.length ?? 0
    } catch {
      return 0
    }
  }, { timeout: 10000 }).toBe(2)

  await relaunchApiaryViaWindowClose(h)

  await expect(h.page.getByTestId('session-column')).toHaveCount(2)
  await expect(h.page.getByTestId('session-tab')).toHaveCount(3)
  await expect(h.page.getByTestId('session-title').last()).toHaveText('Add worktree switcher')
})

test('a shell listed from before a relaunch starts again when shown, rather than a dead cursor', async () => {
  // The shell's process ends with the app, but the restored layout still lists its terminal.
  // Showing the pane used to find that listing, spawn nothing, and attach to a pty that no longer
  // existed: a blinking cursor, no prompt, and hiding and showing again changed nothing.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo BEFORE_$((20+1))\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('BEFORE_21', { timeout: 10000 })

  await relaunchApiary(h)

  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo AFTER_$((40+2))\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('AFTER_42', { timeout: 10000 })
  // Still the one terminal it was, not a second one added beside a dead first.
  await h.page.getByTestId('terminal-list-toggle').click()
  await expect(h.page.getByTestId('terminal-tab-row')).toHaveCount(1)
})

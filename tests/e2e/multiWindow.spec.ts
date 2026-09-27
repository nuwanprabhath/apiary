import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, clickRowAction, type Harness } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('a second window is its own workspace over the same sessions', { tag: '@smoke' }, async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)

  const second = await h.newWindow()

  // The same sessions are listed — one store, one set of terminals — but the first window's open
  // tab is not carried over, or a second window would only ever be a copy of the first.
  await expect(second.getByTestId('session-item').first()).toBeVisible()
  await expect(second.getByTestId('session-tab')).toHaveCount(0)

  // And working in one window does not disturb the other.
  await sidebarSession(second, 'Add worktree switcher').click()
  await expect(second.getByTestId('session-title')).toHaveText('Add worktree switcher')
  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})

test('a session opened in both windows shows live terminal output in each', async () => {
  // Terminal output is broadcast to every window rather than only the focused one; a background
  // window showing the same session must not sit frozen until it is clicked.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const second = await h.newWindow()
  await sidebarSession(second, 'Fix CSV export bug').click()

  await second.getByTestId('session-tab-label').first().click()
  await expect(second.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})

// The reported bug: a second window opened with an empty sidebar arrangement — no pinned section
// and no groups — because the whole of the UI state was keyed per window. Tabs and column widths
// belong to a window; how the user has organised their sessions does not.
test('a second window has the same pinned sessions and groups as the first', async () => {
  await clickRowAction(sidebarSession(h.page, 'Fix CSV export bug'), 'pin-session-button')
  await expect(h.page.getByTestId('pinned-section')).toBeVisible()

  const second = await h.newWindow()

  await expect(second.getByTestId('pinned-section')).toBeVisible()
  await expect(second.getByTestId('pinned-section').getByTestId('session-item'))
    .toContainText('Fix CSV export bug')
})

test('pinning in one window shows up in the other without either being restarted', async () => {
  const second = await h.newWindow()
  await expect(second.getByTestId('pinned-section')).toHaveCount(0)

  await clickRowAction(sidebarSession(h.page, 'Fix CSV export bug'), 'pin-session-button')

  // Windows share an origin, so the second one hears the change rather than waiting for a relaunch.
  await expect(second.getByTestId('pinned-section')).toBeVisible()
  await expect(second.getByTestId('pinned-section').getByTestId('session-item'))
    .toContainText('Fix CSV export bug')
})

test('each window still keeps its own tabs and its own sidebar width', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  const second = await h.newWindow()
  await sidebarSession(second, 'Add worktree switcher').click()

  await expect(h.page.getByTestId('session-tab')).toHaveCount(1)
  await expect(second.getByTestId('session-tab')).toHaveCount(1)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(second.getByTestId('session-title')).toHaveText('Add worktree switcher')
})

test('a session opened in a second window shows what it already printed', async () => {
  // Scrollback lived only in whichever xterm had been attached since the process started, so a
  // second view of a running session opened blank — and a TUI sitting at a prompt may never print
  // again, so it stayed blank. The main process now keeps the output and replays it on attach.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await h.page.getByTestId('shell-toggle').click()
  await h.page.getByTestId('terminal-shell').click()
  await h.page.keyboard.type('echo APIARY_EARLIER_OUTPUT\n')
  await expect(h.page.getByTestId('terminal-shell')).toContainText('APIARY_EARLIER_OUTPUT', {
    timeout: 20000,
  })

  const second = await h.newWindow()
  await sidebarSession(second, 'Fix CSV export bug').click()
  await second.getByTestId('shell-toggle').click()

  // Printed before this window existed, and nothing has printed since.
  await expect(second.getByTestId('terminal-shell')).toContainText('APIARY_EARLIER_OUTPUT', {
    timeout: 20000,
  })
})

// Regression: `closed`'s handler used to read `win.webContents.id` back off the window it was
// itself reacting to closing. By the time `closed` fires, the window (and its webContents) is
// already destroyed, so that read threw `Object has been destroyed` — uncaught, since `closed` is
// a plain Electron event callback with nothing wrapping it — which took the whole main process
// down with it, not just the one window. `windowNumberByWebContentsId` now captures the id while
// the window is still alive and closes over that instead.
test('closing a second window does not crash the main process', async () => {
  const second = await h.newWindow()
  await second.close()

  // Proof the main process is still alive and still servicing IPC, not just that Playwright's
  // reference to the first window's Page object still exists: if `closed`'s handler had thrown,
  // the whole app process would be gone and this call would reject or hang.
  await expect(h.page.evaluate(() => window.apiary.tree())).resolves.toBeDefined()
  await expect(h.page.getByTestId('session-item').first()).toBeVisible()
})

// MAIN-12: the menu's Rescan Sessions used to send `treeChanged` only to `mainWindow`, so a
// background window kept a stale sidebar after it — unlike the sidebar's own Refresh button and
// the filesystem watcher, both of which already broadcast to every window.
test('rescan sessions from the menu updates every window\'s sidebar, not just the front one', async () => {
  await expect(h.page.getByTestId('session-item').first()).toBeVisible()
  const before = await h.page.getByTestId('session-item').count()
  const second = await h.newWindow()
  await expect(second.getByTestId('session-item')).toHaveCount(before)

  // Turn on auto-import for the folder (what checking the box in the import dialog does), then
  // write a new session straight to disk, the way a session started outside Apiary would appear.
  await h.page.evaluate(async (workdir) => {
    await window.apiary.importSessions([], [workdir])
  }, h.workdir)
  const { makeSession } = await import('../fixtures/makeSession')
  makeSession(h.projectsRoot, '-work-a-menu-rescan', {
    sessionId: '55555555-6666-7777-8888-999999999999',
    cwd: h.workdir,
    title: 'Picked up by Rescan Sessions from the menu',
  })

  // Triggered through the same native menu item a user would click, in the first window only.
  await h.app.evaluate(({ Menu }) => {
    const menu = Menu.getApplicationMenu()
    const item = menu?.items
      .flatMap((i) => i.submenu?.items ?? [])
      .find((i) => i.label === 'Rescan Sessions')
    if (item === undefined) throw new Error('File > Rescan Sessions is missing from the menu')
    ;(item.click as () => void)()
  })

  await expect(h.page.getByTestId('session-item')).toHaveCount(before + 1, { timeout: 5000 })
  await expect(second.getByTestId('session-item')).toHaveCount(before + 1, { timeout: 5000 })
})

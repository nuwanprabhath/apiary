import { test, expect } from '@playwright/test'
import { appendFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('the search box clears from its own button', async () => {
  const search = h.page.getByTestId('search-input')
  // The button only exists while there is something to clear — an always-present X over an empty
  // field is just noise.
  await expect(h.page.getByTestId('search-clear')).toHaveCount(0)

  await search.fill('worktree')
  const filtered = await h.page.getByTestId('session-item').count()
  expect(filtered).toBeGreaterThan(0)
  expect(filtered).toBeLessThan(4)

  await h.page.getByTestId('search-clear').click()
  await expect(search).toHaveValue('')
  await expect(h.page.getByTestId('search-clear')).toHaveCount(0)
  await expect(h.page.getByTestId('session-item')).toHaveCount(4)

})

test('the refresh button keeps a stable width while it spins', async () => {
  // Regression: the button used to swap its whole "Refresh" label out for a bare spinner glyph
  // while a refresh was in flight, which visibly shrank the button — jarring, and easy to misread
  // as the control itself vanishing. The label now stays put; only the icon inside it spins.
  const button = h.page.getByTestId('sidebar-refresh')
  const before = await button.boundingBox()
  expect(before).not.toBeNull()

  await button.click()
  // The click may resolve before Playwright gets a chance to observe the spinning state on a
  // fast local scan, so assert on the label staying present rather than racing the spinner.
  await expect(button).toContainText('Refresh')
  const after = await button.boundingBox()
  expect(after).not.toBeNull()
  if (before !== null && after !== null) {
    expect(Math.abs(before.width - after.width)).toBeLessThan(2)
  }
})

test.describe('import dialog, before anything has been imported', () => {
  test.beforeEach(async () => {
    // A fresh harness: `importAll` in the outer beforeEach would leave every row already
    // imported, and an all-imported folder's checkbox is deliberately disabled.
    await h.close()
    h = await launchApiary()
  })

  test('folders collapse, so a long folder is not in the way of the next one', async () => {
    await h.app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('apiary:open-import-dialog')
    })
    await expect(h.page.getByTestId('import-dialog')).toBeVisible()

    const rowsBefore = await h.page.getByTestId('import-session-checkbox').count()
    expect(rowsBefore).toBeGreaterThan(0)

    const firstGroup = h.page.getByTestId('import-group').first()
    await firstGroup.getByTestId('import-group-toggle').click()
    await expect(firstGroup.getByTestId('import-session-checkbox')).toHaveCount(0)
    // Only that folder folded away; the others are untouched.
    await expect(h.page.getByTestId('import-session-checkbox')).toHaveCount(rowsBefore - 1)

    // Collapsed or not, the folder checkbox still selects everything inside it — which is the
    // whole point: tick the folder, fold it, move on to the next one without scrolling past it.
    await firstGroup.getByTestId('import-group-checkbox').check()
    await expect(firstGroup.getByTestId('import-group-checkbox')).toBeChecked()

    await firstGroup.getByTestId('import-group-toggle').click()
    await expect(firstGroup.getByTestId('import-session-checkbox')).toHaveCount(1)
  })
})

test('the transcript follows the session live and opens at the newest message', async () => {
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('transcript')).toBeVisible()

  // Append a fresh turn to the session's own JSONL, exactly as a running `claude` would.
  const dir = join(h.projectsRoot, '-work-a')
  const file = readdirSync(dir).find((f) => f.endsWith('.jsonl'))
  expect(file).toBeDefined()
  appendFileSync(join(dir, String(file)), JSON.stringify({
    sessionId: '11111111-1111-1111-1111-111111111111',
    cwd: h.workdir,
    gitBranch: 'main',
    isSidechain: false,
    version: '2.1.246',
    type: 'assistant',
    uuid: 'live-1',
    timestamp: '2026-09-02T10:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'APPEARED_WITHOUT_SWITCHING' }] },
  }) + '\n')

  // No navigation, no refresh click: the watcher's debounced rescan should bring it in on its own.
  await expect(h.page.getByTestId('transcript')).toContainText('APPEARED_WITHOUT_SWITCHING', {
    timeout: 20000,
  })

  // And the newest message is what you land on, rather than having to scroll down to find it.
  const atBottom = await h.page.getByTestId('transcript').evaluate(
    (el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 64,
  )
  expect(atBottom).toBe(true)
})

test('the transcript catches up to the newest message when you switch back to it', async () => {
  // Item 15: while the live terminal is in front the transcript stays mounted and keeps merging in
  // new messages, but a hidden element cannot be scrolled — `scrollTop` on a `display: none` box
  // is a no-op. The deferred scroll used to be consumed and discarded there, so coming back to the
  // transcript landed you on the oldest message instead of what the session had just said.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await expect(h.page.getByTestId('transcript')).toBeVisible()

  // Enough turns that the transcript genuinely scrolls, or "at the bottom" means nothing.
  const dir = join(h.projectsRoot, '-work-a')
  const file = readdirSync(dir).find((f) => f.endsWith('.jsonl'))
  expect(file).toBeDefined()
  const line = (i: number): string => JSON.stringify({
    sessionId: '11111111-1111-1111-1111-111111111111',
    cwd: h.workdir,
    gitBranch: 'main',
    isSidechain: false,
    version: '2.1.246',
    type: 'assistant',
    uuid: `bulk-${String(i)}`,
    timestamp: '2026-09-02T10:00:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: `bulk message ${String(i)} ${'x'.repeat(200)}` }] },
  })
  appendFileSync(join(dir, String(file)), Array.from({ length: 40 }, (_, i) => line(i)).join('\n') + '\n')
  await expect(h.page.getByTestId('transcript')).toContainText('bulk message 39', { timeout: 20000 })

  // Switch to the live terminal, so the transcript is mounted but hidden...
  await h.page.getByTestId('resume-button').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()

  // ...and a further turn lands while you are not looking at it.
  appendFileSync(join(dir, String(file)), JSON.stringify({
    sessionId: '11111111-1111-1111-1111-111111111111',
    cwd: h.workdir,
    gitBranch: 'main',
    isSidechain: false,
    version: '2.1.246',
    type: 'assistant',
    uuid: 'arrived-while-hidden',
    timestamp: '2026-09-02T10:05:00.000Z',
    message: { role: 'assistant', content: [{ type: 'text', text: 'ARRIVED_WHILE_ON_THE_TERMINAL' }] },
  }) + '\n')
  await h.page.waitForTimeout(3000)

  await h.page.getByTestId('view-transcript').click()
  await expect(h.page.getByTestId('transcript')).toBeVisible()

  // It is there, and it is what you are looking at — not something you have to scroll to find.
  await expect(h.page.getByTestId('transcript')).toContainText('ARRIVED_WHILE_ON_THE_TERMINAL', { timeout: 20000 })
  await expect.poll(async () => h.page.getByTestId('transcript').evaluate(
    (el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 64,
  )).toBe(true)
})

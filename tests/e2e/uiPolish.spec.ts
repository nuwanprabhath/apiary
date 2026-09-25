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

test('pressing Refresh says what the rescan found', async () => {
  // A rescan usually changes nothing on screen — the watcher has normally seen the disk already —
  // so without a sentence afterwards the only feedback is a spinner stopping, which is
  // indistinguishable from a button that does nothing at all.
  await h.page.getByTestId('sidebar-refresh').click()

  // `.last()`: the harness itself presses Refresh once during setup, and that first press has
  // something to report (the freshly imported sessions), so there are two of these on screen.
  const note = h.page.getByTestId('notification').filter({ hasText: 'Rescanned' }).last()
  await expect(note).toBeVisible()
  await expect(note).toHaveAttribute('data-kind', 'info')
  // Nothing was added between the two scans, and the message says so rather than claiming a
  // number it cannot support.
  await expect(note).toContainText('no new sessions')
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
  // Nothing on screen shows the hidden transcript catching up, so ask the main process, through
  // the renderer's own bridge, until the transcript it serves has the new turn — then switch back.
  await expect.poll(() => h.page.evaluate(async () => {
    const page = await window.apiary.transcript('11111111-1111-1111-1111-111111111111')
    return page.messages.some((m) => m.uuid === 'arrived-while-hidden')
  }), { timeout: 20000 }).toBe(true)

  await h.page.getByTestId('view-transcript').click()
  await expect(h.page.getByTestId('transcript')).toBeVisible()

  // It is there, and it is what you are looking at — not something you have to scroll to find.
  await expect(h.page.getByTestId('transcript')).toContainText('ARRIVED_WHILE_ON_THE_TERMINAL', { timeout: 20000 })
  await expect.poll(async () => h.page.getByTestId('transcript').evaluate(
    (el) => el.scrollHeight - el.scrollTop - el.clientHeight <= 64,
  )).toBe(true)
})

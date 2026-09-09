import { test, expect } from '@playwright/test'
import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})
test.afterEach(async () => { await h.close() })

test('a session whose transcript file is gone explains itself instead of blanking the pane', async () => {
  // Exactly the reported case: the folder a session ran in (a git worktree) is removed, taking
  // `~/.claude/projects/<slug>` with it, while the session is still listed in Apiary's own store.
  const dir = join(h.projectsRoot, '-work-a')
  const file = readdirSync(dir).find((f) => f.endsWith('.jsonl'))
  expect(file).toBeDefined()
  rmSync(join(dir, String(file)))

  await sidebarSession(h.page, 'Fix CSV export bug').click()

  const pane = h.page.getByTestId('transcript-error')
  await expect(pane).toBeVisible()
  // The app is still there: a failure in one pane must not take the sidebar with it.
  await expect(h.page.getByTestId('search-input')).toBeVisible()

  // And the message is a sentence, not Electron's IPC plumbing wrapped around Node's errno.
  const headline = pane.locator('.crash-message')
  await expect(headline).toContainText(/no longer on disk/i)
  await expect(headline).not.toContainText('Error invoking remote method')
  await expect(headline).not.toContainText('ENOENT')

  // Retrying is offered, and still fails the same way rather than doing nothing visible.
  await h.page.getByTestId('transcript-retry').click()
  await expect(headline).toContainText(/no longer on disk/i)
})

test('a failed git action is reported as a dismissible notification with the raw error behind it', async () => {
  await sidebarSession(h.page, 'Repo root session').click()
  // repo-c has no remote configured, so pushing can only fail.
  await h.page.getByTestId('toolbar-push').click()

  const note = h.page.locator('[data-testid="notification"][data-kind="error"]')
  await expect(note).toBeVisible()
  await expect(note.getByTestId('notification-message')).toContainText(/Push failed/i)

  // The technical text is available but folded away, so the headline stays readable.
  await expect(note.getByTestId('notification-detail')).toHaveCount(0)
  await note.getByTestId('notification-detail-toggle').click()
  await expect(note.getByTestId('notification-detail')).toBeVisible()

  await note.getByTestId('notification-close').click()
  await expect(h.page.getByTestId('notification')).toHaveCount(0)
})

test('an error nothing else caught still reaches the user', async () => {
  // The safety net: a rejected promise with no `.catch` anywhere reaches the window, and used to
  // end up only in a devtools console the user never opens.
  await h.page.evaluate(() => {
    void Promise.reject(new Error('NOBODY_CAUGHT_THIS'))
  })

  const note = h.page.locator('[data-testid="notification"][data-kind="error"]')
  await expect(note).toBeVisible()
  await expect(note).toContainText('NOBODY_CAUGHT_THIS')
})

test('a crash while rendering a session is caught and explained, never left blank', async () => {
  // Two sessions open as tabs in the same column: only the active tab's transcript is mounted,
  // so switching between them unmounts one and mounts the other — a real DOM removal inside the
  // column's own subtree, which is what the sabotage below turns into a render-time throw.
  await sidebarSession(h.page, 'Fix CSV export bug').click()
  await sidebarSession(h.page, 'Add worktree switcher').click()
  await expect(h.page.getByTestId('transcript')).toBeVisible()

  // The session heading's editable title is keyed by session id, so switching tabs makes React
  // unmount one and mount the other — a real removal from this <h1>, inside the column's own
  // subtree. Making that removal throw is the closest a test can get from outside to a component
  // blowing up mid-render.
  await h.page.evaluate(() => {
    const heading = document.querySelector('[data-testid="session-title"]')
    if (heading === null) throw new Error('no session heading to sabotage')
    heading.removeChild = () => { throw new Error('DELIBERATE_RENDER_CRASH') }
  })

  await h.page.getByTestId('session-tab').filter({ hasText: 'Fix CSV export bug' }).click()

  // The whole point: something to read, and a way forward — never an empty window.
  const crash = h.page.getByTestId('crash-pane')
  await expect(crash).toBeVisible()
  await expect(h.page.getByTestId('crash-message')).toContainText('DELIBERATE_RENDER_CRASH')
  await expect(h.page.getByTestId('crash-reload')).toBeVisible()

  // The stack is kept, folded away, so a bug report can carry more than the one-line message.
  await expect(crash.locator('summary')).toBeVisible()
})

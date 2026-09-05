import { test, expect } from '@playwright/test'
import { launchApiary, importAll, relaunchApiary, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.page.getByText('Fix CSV export bug').click()
})
test.afterEach(async () => { await h.close() })

test('renaming a session updates the header and the sidebar row, and survives a relaunch', async () => {
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')

  await h.page.getByTestId('session-title-edit').click()
  const input = h.page.getByTestId('session-title-input')
  await expect(input).toBeFocused()
  await input.fill('My renamed session')
  await input.press('Enter')

  // The input is gone and the header reflects the new title immediately.
  await expect(h.page.getByTestId('session-title-input')).toHaveCount(0)
  await expect(h.page.getByTestId('session-title')).toHaveText('My renamed session')

  // The sidebar row picks it up too, without a manual refresh (the rename IPC handler pushes
  // the same "tree changed" signal the filesystem watcher uses). Scoped to the sidebar row
  // itself — the header above also now contains this text.
  await expect(h.page.getByTestId('session-item').filter({ hasText: 'My renamed session' })).toBeVisible()
  await expect(h.page.getByTestId('session-item').filter({ hasText: 'Fix CSV export bug' })).toHaveCount(0)

  // The rename is a real store write, not just optimistic renderer state — it survives a relaunch.
  await relaunchApiary(h)
  await expect(h.page.getByTestId('session-title')).toHaveText('My renamed session')
})

test('Escape cancels an in-progress rename without changing the title', async () => {
  await h.page.getByTestId('session-title-edit').click()
  const input = h.page.getByTestId('session-title-input')
  await input.fill('Should not be saved')
  await input.press('Escape')

  await expect(h.page.getByTestId('session-title-input')).toHaveCount(0)
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
})

test('blurring the input commits the rename, same as Enter', async () => {
  await h.page.getByTestId('session-title-edit').click()
  await h.page.getByTestId('session-title-input').fill('Committed on blur')
  await h.page.getByTestId('content').click({ position: { x: 5, y: 5 } })

  await expect(h.page.getByTestId('session-title-input')).toHaveCount(0)
  await expect(h.page.getByTestId('session-title')).toHaveText('Committed on blur')
})

test('opening the rename editor on a different session starts from that session\'s own title, not a leftover draft', async () => {
  // Clicking another session's row blurs the currently-focused input first, which commits it
  // (same as pressing Enter) — since nothing was typed, the commit is a same-value no-op, not a
  // rename. This exercises that path deliberately: open A's editor, leave it untouched, then
  // switch to B.
  await h.page.getByTestId('session-title-edit').click()
  await h.page.getByText('Add worktree switcher').click()
  await expect(h.page.getByTestId('session-title')).toHaveText('Add worktree switcher')

  // B's own editor must start from B's title, not whatever was last open for A (the `key`ed
  // remount in App.tsx is what guarantees this).
  await h.page.getByTestId('session-title-edit').click()
  await expect(h.page.getByTestId('session-title-input')).toHaveValue('Add worktree switcher')
  await h.page.getByTestId('session-title-input').press('Escape')

  // And switching back, A's own title is untouched by any of the above.
  await h.page.getByText('Fix CSV export bug').click()
  await expect(h.page.getByTestId('session-title')).toHaveText('Fix CSV export bug')
  await expect(h.page.getByTestId('session-title-input')).toHaveCount(0)
})

import { test, expect } from '@playwright/test'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary({ secondWorktree: true })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

/** The worktree folder row a session is dropped onto in these tests. */
function targetFolder(h: Harness) {
  return h.page.locator(
    'div.project-row-wrap:has(> button[data-testid="project-toggle"] .project-label:text-is("repo-c-wt2"))',
  )
}

test('dragging a session onto another worktree moves it there', async () => {
  const title = 'Fix CSV export bug'
  await sidebarSession(h.page, title).dragTo(targetFolder(h))

  await expect(h.page.getByTestId('move-session-dialog')).toBeVisible()
  await expect(h.page.getByTestId('move-session-dialog')).toContainText(title)
  await h.page.getByTestId('move-session-confirm').click()

  await expect(h.page.getByTestId('move-session-dialog')).toHaveCount(0)

  // The session now shows up under repo-c-wt2 rather than its original folder ("work-a") — its
  // row is a sibling of the folder header, inside the same <li data-testid="project-group">.
  const targetGroup = targetFolder(h).locator('xpath=ancestor::li[@data-testid="project-group"][1]')
  await expect(targetGroup).toContainText(title)

  // Still opens after the move.
  await sidebarSession(h.page, title).click()
  await expect(h.page.getByTestId('terminal-view').or(h.page.getByTestId('transcript'))).toBeVisible()

  // A rescan must not undo the move — the whole point of the `cwd_override` column.
  await h.page.getByTestId('sidebar-refresh').click()
  await expect(targetGroup).toContainText(title)
})

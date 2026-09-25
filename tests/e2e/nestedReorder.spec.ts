import { test, expect, type Locator, type Page } from '@playwright/test'
import { launchApiary, importAll, relaunchApiary, type Harness } from './helpers'

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary({ secondWorktree: true })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

/** A nested folder row — a worktree under its repository — addressed by its own label. */
function worktree(page: Page, label: string): Locator {
  return page.locator(
    `div.project-row-wrap[data-depth="1"]:has(> button[data-testid="project-toggle"] .project-label:text-is("${label}"))`,
  )
}

async function worktreeOrder(page: Page): Promise<string[]> {
  const labels = page.locator(
    'div.project-row-wrap[data-depth="1"] > button[data-testid="project-toggle"] .project-label',
  )
  await expect(labels.first()).toBeVisible()
  return labels.allInnerTexts()
}

// The worktrees under a repository are as much a list with an order worth having as the top-level
// folders are — which of 1.0.11 and 1.0.12 comes first is the user's call, not the scan's.
test('a worktree can be dragged above its sibling, and stays there across a restart', async () => {
  await expect.poll(async () => worktreeOrder(h.page)).toEqual(['repo-c-wt', 'repo-c-wt2'])

  await worktree(h.page, 'repo-c-wt2').dragTo(worktree(h.page, 'repo-c-wt'))
  expect(await worktreeOrder(h.page)).toEqual(['repo-c-wt2', 'repo-c-wt'])

  await relaunchApiary(h)
  await expect.poll(async () => worktreeOrder(h.page)).toEqual(['repo-c-wt2', 'repo-c-wt'])
})

// The reported case, and the one the plain test above cannot see: the repository was filed into
// a group. A group is a drop target over its whole area, so a drop that landed on a worktree row
// inside it also reached the group — and the group's own handler wrote back a copy of the
// arrangement that predated the reorder, silently undoing it.
test('a worktree inside a grouped repository can still be reordered', async () => {
  await expect.poll(async () => worktreeOrder(h.page)).toEqual(['repo-c-wt', 'repo-c-wt2'])

  await h.page.locator(
    'div.project-row-wrap[data-depth="0"]:has(> button[data-testid="project-toggle"] .project-label:text-is("repo-c"))',
  ).click({ button: 'right' })
  await h.page.getByTestId('context-menu-new-group').click()
  await h.page.getByTestId('folder-group-rename').press('Enter')
  await expect(h.page.getByTestId('folder-group')).toHaveCount(1)

  await worktree(h.page, 'repo-c-wt2').dragTo(worktree(h.page, 'repo-c-wt'))
  expect(await worktreeOrder(h.page)).toEqual(['repo-c-wt2', 'repo-c-wt'])
})

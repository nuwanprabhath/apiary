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

import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchApiary, importAll, type Harness } from './helpers'

/**
 * A sidebar folder's "Change branch…" against real git: the folder is named by path, which only
 * main's own project rows can vouch for, and taking a branch the repository root has moves the
 * root in the same step — both checkouts real, both rows re-read.
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

const branchOf = (cwd: string): string =>
  execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd, encoding: 'utf8' }).trim()

test('swaps a worktree\'s branch with the worktree that has the one it wants', async () => {
  const rootBranch = branchOf(h.repoRoot)
  const wtBranch = branchOf(h.worktreeDir)
  const row = h.page.locator(`.project-row-wrap[data-folder-path="${h.worktreeDir}"]`)
  await row.click({ button: 'right' })
  await h.page.getByTestId('context-menu-change-branch').click()
  await h.page.getByTestId('branch-switcher-branch-row').getByText(rootBranch, { exact: true }).click()

  await expect(h.page.getByTestId('worktree-conflict-dialog')).toBeVisible()
  // This folder's own branch first, as a swap, and highlighted.
  await expect(h.page.locator('[data-testid="worktree-conflict-choice"][data-active="true"]')).toHaveAttribute('data-branch', wtBranch)
  await h.page.getByTestId('worktree-conflict-move').click()
  await expect(h.page.getByTestId('worktree-conflict-dialog')).toBeHidden()

  expect(branchOf(h.worktreeDir)).toBe(rootBranch)
  expect(branchOf(h.repoRoot)).toBe(wtBranch)
  // Both rows show their new branch.
  await expect(row.locator('.branch').first()).toHaveText(rootBranch)
  await expect(h.page.locator(`.project-row-wrap[data-folder-path="${h.repoRoot}"] .branch`).first()).toHaveText(wtBranch)
})

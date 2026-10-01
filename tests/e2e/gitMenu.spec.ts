import { test, expect } from '@playwright/test'
import { git, commitFile } from '../fixtures/gitRepo'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * The menu-groups, Escape-closes and click-outside-closes behaviour moved to
 * tests/component/gitMenu.test.tsx, driven against the fake `window.apiary`. What is left here are
 * the two merges that need a real git repository: one that really merges on disk, and one whose
 * conflict really leaves the working tree mid-merge for the shell below to resolve.
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await sidebarSession(h.page, 'Repo root session').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})

test.afterEach(async () => { await h.close() })

test('Branch > Merge merges a branch you pick into the current one', async () => {
  // A branch with a commit the current branch does not have, so the merge is a real one.
  git(h.repoRoot, 'checkout', '-q', '-b', 'feature/mergeable')
  commitFile(h.repoRoot, 'merged.txt', 'a commit to merge', 'merged-content\n')
  git(h.repoRoot, 'checkout', '-q', 'main')

  await h.page.getByTestId('toolbar-git-menu').click()
  await h.page.getByTestId('git-menu-branch').click()
  await h.page.getByTestId('git-menu-branch-merge').click()

  // The same searchable ref list the branch switcher uses, doing a different job.
  const picker = h.page.getByTestId('branch-switcher')
  await expect(picker).toBeVisible()
  await expect(picker.getByTestId('branch-switcher-search')).toHaveAttribute(
    'placeholder', /merge into main/i,
  )
  // Creating/checking out a branch is meaningless while picking something to merge.
  await expect(picker.getByTestId('branch-switcher-create')).toHaveCount(0)

  await picker.getByTestId('branch-switcher-search').fill('mergeable')
  await picker.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/mergeable' }).click()
  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)

  // The merge really happened, on disk, on the branch we were on.
  const log = git(h.repoRoot, 'log', '--oneline', 'main')
  expect(log).toContain('a commit to merge')
  // And we are still on main, not moved onto the branch that was merged in.
  const branch = git(h.repoRoot, 'rev-parse', '--abbrev-ref', 'HEAD').trim()
  expect(branch).toBe('main')
})

test('a conflicting merge reports the conflict and leaves the repo mid-merge to resolve', async () => {
  git(h.repoRoot, 'checkout', '-q', '-b', 'feature/conflicting')
  commitFile(h.repoRoot, 'README.md', 'branch edit', 'from-branch\n')
  git(h.repoRoot, 'checkout', '-q', 'main')
  commitFile(h.repoRoot, 'README.md', 'main edit', 'from-main\n')

  await h.page.getByTestId('toolbar-git-menu').click()
  await h.page.getByTestId('git-menu-branch').click()
  await h.page.getByTestId('git-menu-branch-merge').click()
  await h.page.getByTestId('branch-switcher-search').fill('conflicting')
  await h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/conflicting' }).click()

  // The popup stays open showing git's own conflict text, rather than closing over a repo the
  // user would then have to notice is halfway through a merge.
  await expect(h.page.getByTestId('branch-switcher-error')).toBeVisible()
  await expect(h.page.getByTestId('branch-switcher-error')).toContainText(/conflict/i)

  // Deliberately not aborted: the shell below is where this gets resolved.
  const status = git(h.repoRoot, 'status', '--porcelain')
  expect(status).toMatch(/^(UU|AA)/m)
})

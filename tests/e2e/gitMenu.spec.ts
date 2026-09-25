import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
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
  execFileSync('git', ['checkout', '-q', '-b', 'feature/mergeable'], { cwd: h.repoRoot })
  execFileSync('bash', ['-c', 'echo merged-content > merged.txt'], { cwd: h.repoRoot })
  execFileSync('git', ['add', '.'], { cwd: h.repoRoot })
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'a commit to merge'], { cwd: h.repoRoot })
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: h.repoRoot })

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
  const log = execFileSync('git', ['log', '--oneline', 'main'], { cwd: h.repoRoot }).toString()
  expect(log).toContain('a commit to merge')
  // And we are still on main, not moved onto the branch that was merged in.
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: h.repoRoot }).toString().trim()
  expect(branch).toBe('main')
})

test('a conflicting merge reports the conflict and leaves the repo mid-merge to resolve', async () => {
  execFileSync('git', ['checkout', '-q', '-b', 'feature/conflicting'], { cwd: h.repoRoot })
  execFileSync('bash', ['-c', 'echo from-branch > README.md'], { cwd: h.repoRoot })
  execFileSync('git', ['add', '.'], { cwd: h.repoRoot })
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'branch edit'], { cwd: h.repoRoot })
  execFileSync('git', ['checkout', '-q', 'main'], { cwd: h.repoRoot })
  execFileSync('bash', ['-c', 'echo from-main > README.md'], { cwd: h.repoRoot })
  execFileSync('git', ['add', '.'], { cwd: h.repoRoot })
  execFileSync('git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'main edit'], { cwd: h.repoRoot })

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
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: h.repoRoot }).toString()
  expect(status).toMatch(/^(UU|AA)/m)
})

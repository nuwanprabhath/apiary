import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { launchApiary, importAll, type Harness } from './helpers'

/**
 * "+" on a git folder → New worktree…, against real git: the folder goes in `<repo>.worktrees/`
 * beside the main checkout (the simple-worktrees layout), on the branch picked, and a Claude
 * session starts in it. Only the real bridge can prove main derives the path itself and runs
 * `git worktree add` — the component test's fake just records the request.
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

const folder = (label: string) => h.page.locator(
  `.project-row-wrap:has(> button[data-testid="project-toggle"] .project-label:text-is("${label}"))`,
)

test('creates a worktree on a new branch and starts Claude in it', async () => {
  await folder('repo-c').hover()
  await folder('repo-c').getByTestId('new-session-button').click()
  await h.page.getByTestId('context-menu-new-worktree').click()

  await h.page.getByTestId('new-worktree-name').fill('species-list')
  await expect(h.page.getByTestId('new-worktree-location')).toContainText(`${h.repoRoot}.worktrees/species-list`)
  await h.page.getByTestId('new-worktree-next').click()

  // feature/wt is checked out in repo-c-wt, so it cannot go in a second worktree.
  await expect(h.page.getByTestId('new-worktree-local-row').filter({ hasText: 'feature/wt' })).toBeDisabled()
  await h.page.getByTestId('new-worktree-new-branch').click()
  await h.page.getByTestId('new-worktree-local-row').filter({ hasText: 'main' }).click()
  await expect(h.page.getByTestId('new-worktree-branch-name')).toHaveValue('species-list')
  await h.page.getByTestId('new-worktree-create').click()

  const target = `${h.repoRoot}.worktrees/species-list`
  await expect.poll(() => existsSync(target)).toBe(true)
  const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: target }).toString().trim()
  expect(branch).toBe('species-list')
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()
})

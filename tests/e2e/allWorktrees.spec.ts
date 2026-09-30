import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { launchApiary, importAll, type Harness } from './helpers'

/**
 * "Show all worktrees" against real git: a worktree Claude has never run in has no transcript, so
 * nothing in `~/.claude/projects` names it and the tree cannot know it exists. The folder menu asks
 * git instead — and main has to accept a new session in a folder it has no project row for, which
 * only the real bridge can prove (the component test's fake accepts any path).
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

test('starts a session in a worktree no session has run in', async () => {
  const quiet = join(h.home, 'repo-quiet')
  execFileSync('git', ['worktree', 'add', '-q', '-b', 'quiet', quiet], { cwd: h.repoRoot, stdio: 'pipe' })

  const folder = (label: string) => h.page.locator(
    `.project-row-wrap:has(> button[data-testid="project-toggle"] .project-label:text-is("${label}"))`,
  )
  await expect(folder('repo-quiet')).toHaveCount(0)

  await folder('repo-c').click({ button: 'right' })
  await h.page.getByTestId('context-menu-show-all-worktrees').click()
  await expect(folder('repo-quiet')).toBeVisible()
  await expect(folder('repo-quiet').locator('.branch')).toHaveText('quiet')

  await folder('repo-quiet').hover()
  await folder('repo-quiet').getByTestId('new-session-button').click()
  // A worktree is a git folder: its "+" offers a session here or a new worktree.
  await h.page.getByTestId('context-menu-new-session').click()
  await expect(h.page.getByTestId('terminal-session')).toBeVisible()
  await expect(h.page.getByTestId('notification').filter({ hasText: 'Could not start' })).toHaveCount(0)
})

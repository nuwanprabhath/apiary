import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, type Harness, sidebarSession } from './helpers'

/**
 * Everything about the branch switcher itself — searching, checking out, creating branches, the
 * worktree-conflict dialog — moved to tests/component/gitToolbar.test.tsx, driven against the fake
 * `window.apiary`. What is left here needs a real remote or a real filesystem to pull from: copying
 * to the OS clipboard, a push/pull round trip against a real bare repo, and a pull that fast-forwards
 * a branch from its real upstream.
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

test('shows the current branch and lets you copy it', { tag: '@serial' }, async () => {
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('main')
  await h.page.getByTestId('toolbar-copy').click()
  const clipboardText = await h.app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clipboardText).toBe('main')
})

test('pull and push succeed against a real remote and refresh the branch button', { tag: '@smoke' }, async () => {
  const remote = h.repoRoot + '-remote.git'
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: h.repoRoot })

  // Both commands are silent on success at the git level, so the toolbar says so instead —
  // and the absence of an error notification is what proves nothing went wrong.
  await h.page.getByTestId('toolbar-push').click()
  await expect(h.page.getByTestId('notification').filter({ hasText: 'Published the branch with 1 commit.' })).toBeVisible()
  await expect(h.page.locator('[data-testid="notification"][data-kind="error"]')).toHaveCount(0)

  await h.page.getByTestId('toolbar-pull').click()
  await expect(h.page.getByTestId('notification').filter({ hasText: 'Already up to date.' })).toBeVisible()
  await expect(h.page.locator('[data-testid="notification"][data-kind="error"]')).toHaveCount(0)
})

test('a branch row pulls that branch from its upstream, without checking it out', async () => {
  const remote = h.repoRoot + '-remote.git'
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: h.repoRoot })
  execFileSync('git', ['push', '-q', '-u', 'origin', 'main'], { cwd: h.repoRoot })
  execFileSync('git', ['branch', 'feature/behind'], { cwd: h.repoRoot })
  execFileSync('git', ['push', '-q', '-u', 'origin', 'feature/behind'], { cwd: h.repoRoot })
  // Someone else pushes a commit to feature/behind.
  const other = h.repoRoot + '-other'
  execFileSync('git', ['clone', '-q', '-b', 'feature/behind', remote, other])
  writeFileSync(join(other, 'theirs.txt'), 'theirs')
  execFileSync('git', ['add', '.'], { cwd: other })
  execFileSync('git', ['-c', 'user.email=o@example.com', '-c', 'user.name=Other', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'theirs'], { cwd: other })
  execFileSync('git', ['push', '-q', 'origin', 'feature/behind'], { cwd: other })

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-search').fill('behind')
  const item = h.page.locator('.branch-switcher-item:has([data-testid="branch-switcher-branch-row"])').filter({ hasText: 'feature/behind' })
  const pull = item.getByTestId('branch-switcher-pull')
  await expect(pull).toBeHidden()
  await item.hover()
  await pull.click()

  await expect(h.page.getByTestId('notification').filter({ hasText: 'Pulled 1 commit into feature/behind.' })).toBeVisible()
  const tip = (ref: string): string => execFileSync('git', ['rev-parse', ref], { cwd: h.repoRoot }).toString().trim()
  expect(tip('feature/behind')).toBe(tip('origin/feature/behind'))
  // Not a checkout: still on main, switcher still open.
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('main')
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
  // Remote branches and tags have no pull button — only local branches can be brought up to date.
  await expect(h.page.locator('.branch-switcher-item:has([data-testid="branch-switcher-remote-row"]) [data-testid="branch-switcher-pull"]')).toHaveCount(0)
})

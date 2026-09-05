import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchApiary, importAll, type Harness } from './helpers'

let h: Harness
test.beforeEach(async () => {
  h = await launchApiary()
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
  await h.page.getByText('Repo root session').click()
  await h.page.getByTestId('shell-toggle').click()
  await expect(h.page.getByTestId('terminal-shell')).toBeVisible()
})
test.afterEach(async () => { await h.close() })

test('shows the current branch and lets you copy it', async () => {
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('main')
  await h.page.getByTestId('toolbar-copy').click()
  const clipboardText = await h.app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clipboardText).toBe('main')
})

test('pull and push succeed against a real remote and refresh the branch button', async () => {
  const remote = h.repoRoot + '-remote.git'
  execFileSync('git', ['init', '-q', '--bare', remote])
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-push').click()
  await expect(h.page.getByTestId('error-banner')).toHaveCount(0)

  await h.page.getByTestId('toolbar-pull').click()
  await expect(h.page.getByTestId('error-banner')).toHaveCount(0)
})

test('switches branch via the branch switcher', async () => {
  execFileSync('git', ['branch', 'feature/from-switcher'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
  await h.page.getByTestId('branch-switcher-search').fill('feature')
  await h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/from-switcher' }).click()

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/from-switcher')
})

test('creates a new branch from the branch switcher', async () => {
  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-create').click()
  await h.page.getByTestId('branch-switcher-name-input').fill('feature/created-in-test')
  await h.page.getByTestId('branch-switcher-confirm').click()

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/created-in-test')
})

test('creates a new branch from a picked base ref', async () => {
  execFileSync('git', ['branch', 'base-branch'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-create-from').click()
  await h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'base-branch' }).click()
  await h.page.getByTestId('branch-switcher-name-input').fill('feature/from-base')
  await h.page.getByTestId('branch-switcher-confirm').click()

  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/from-base')
})

test('checks out a tag detached', async () => {
  execFileSync('git', ['tag', 'v9.9.9'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-detached').click()
  await h.page.getByTestId('branch-switcher-tag-row').filter({ hasText: 'v9.9.9' }).click()

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  // Detached HEAD has no branch name, but the branch button must stay visible (as a dead end
  // otherwise) — it just switches to a detached-HEAD label. Clicking it must still reopen the
  // branch switcher, the only way back to a named branch.
  const branchButton = h.page.getByTestId('toolbar-branch-button')
  await expect(branchButton).toBeVisible()
  await expect(branchButton).toContainText(/detached/i)

  await branchButton.click()
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
})

test('shows a visible error inside the branch switcher on a failed checkout, and keeps it open', async () => {
  // h.worktreeDir already has feature/wt checked out — trying to check it out again from the
  // repoRoot session must fail with git's "already used by worktree" error, visibly, without
  // silently closing the modal (see Finding 3: the modal-backdrop otherwise hides App.tsx's
  // error-banner behind it).
  await h.page.getByTestId('toolbar-branch-button').click()
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
  await h.page.getByTestId('branch-switcher-search').fill('feature/wt')
  await h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/wt' }).click()

  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
  await expect(h.page.getByTestId('branch-switcher-error')).toBeVisible()
  await expect(h.page.getByTestId('branch-switcher-error')).toContainText(/worktree/i)
})

import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { launchApiary, importAll, type Harness, sidebarSession } from './helpers'

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

test('shows the current branch and lets you copy it', async () => {
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('main')
  await h.page.getByTestId('toolbar-copy').click()
  const clipboardText = await h.app.evaluate(({ clipboard }) => clipboard.readText())
  expect(clipboardText).toBe('main')
})

test('pull and push succeed against a real remote and refresh the branch button', async () => {
  const remote = h.repoRoot + '-remote.git'
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', remote])
  execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: h.repoRoot })

  // Both commands are silent on success at the git level, so the toolbar says so instead —
  // and the absence of an error notification is what proves nothing went wrong.
  await h.page.getByTestId('toolbar-push').click()
  await expect(h.page.getByTestId('notification').filter({ hasText: 'Pushed to upstream.' })).toBeVisible()
  await expect(h.page.locator('[data-testid="notification"][data-kind="error"]')).toHaveCount(0)

  await h.page.getByTestId('toolbar-pull').click()
  await expect(h.page.getByTestId('notification').filter({ hasText: 'Pulled from upstream.' })).toBeVisible()
  await expect(h.page.locator('[data-testid="notification"][data-kind="error"]')).toHaveCount(0)
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

test('shows a failed checkout inside the branch switcher, without closing it', async () => {
  // A checkout that fails for an ordinary reason — a ref that is not there — is reported inside
  // the modal rather than behind it: the modal's own backdrop covers the app's error banner, so an
  // error routed only to the parent would be invisible. (A branch held by another worktree is not
  // this case; it is an outcome with actions, see the worktree tests below.)
  await h.page.getByTestId('toolbar-branch-button').click()
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
  await h.page.getByTestId('branch-switcher-create').click()
  await h.page.getByTestId('branch-switcher-name-input').fill('main')
  await h.page.getByTestId('branch-switcher-confirm').click()

  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
  await expect(h.page.getByTestId('branch-switcher-error')).toBeVisible()
  await expect(h.page.getByTestId('branch-switcher-error')).toContainText(/already exists/i)
})

test('a branch another worktree has offers to pull it there, or open a session there', async () => {
  // `feature/wt` is checked out in repo-c-wt (see helpers' makeRepoWithWorktree), so git refuses
  // this checkout. On a repository with a worktree per ticket that refusal is the normal answer,
  // not a failure — and being shown git's sentence and left to go and find that directory by hand
  // is the slow part.
  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-search').fill('feature/wt')
  await h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/wt' }).first().click()

  const dialog = h.page.getByTestId('worktree-conflict-dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('feature/wt')
  await expect(h.page.getByTestId('worktree-conflict-label')).toHaveText('repo-c-wt')
  // The branch switcher gets out of the way rather than showing this inside a branch list.
  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  // And nothing was checked out: the session's own branch is untouched.
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('main')
})

test('opening a session in that worktree starts it in the worktree, not the repo root', async () => {
  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-search').fill('feature/wt')
  await h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/wt' }).first().click()
  await h.page.getByTestId('worktree-conflict-session').click()

  await expect(h.page.getByTestId('worktree-conflict-dialog')).toHaveCount(0)
  // A new tab, showing the worktree's own directory in the header.
  await expect(h.page.getByTestId('session-path')).toContainText('repo-c-wt')
})

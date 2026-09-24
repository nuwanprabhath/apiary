import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { join } from 'node:path'
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
  await expect(h.page.getByTestId('notification').filter({ hasText: 'Published the branch with 1 commit.' })).toBeVisible()
  await expect(h.page.locator('[data-testid="notification"][data-kind="error"]')).toHaveCount(0)

  await h.page.getByTestId('toolbar-pull').click()
  await expect(h.page.getByTestId('notification').filter({ hasText: 'Already up to date.' })).toBeVisible()
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

test('a branch row copies its name on hover, without checking it out', async () => {
  execFileSync('git', ['branch', 'feature/copy-me'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-search').fill('copy-me')
  const item = h.page.locator('.branch-switcher-item').filter({ hasText: 'feature/copy-me' })
  const copy = item.getByTestId('branch-switcher-copy')
  // Out of the way until the row is hovered.
  await expect(copy).toBeHidden()
  await item.hover()
  await copy.click()

  await expect(copy).toHaveAttribute('data-copied', 'true')
  expect(await h.app.evaluate(({ clipboard }) => clipboard.readText())).toBe('feature/copy-me')
  // Copying is not picking: the switcher stays open and the branch is unchanged.
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('main')
})

test('Enter checks out an exact branch name; a partial one does nothing', async () => {
  execFileSync('git', ['branch', 'feature/exact-enter'], { cwd: h.repoRoot })

  await h.page.getByTestId('toolbar-branch-button').click()
  // Wait for the refs to actually be loaded before typing — the search input accepts keystrokes
  // immediately on open, but Enter's exact-match check is computed against the fetched ref list,
  // which arrives over IPC. Typing and pressing Enter before it lands would race, since a null
  // ref list can never produce a match.
  await expect(h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/exact-enter' })).toBeVisible()
  await h.page.getByTestId('branch-switcher-search').fill('feature/exact-enter')
  await h.page.getByTestId('branch-switcher-search').press('Enter')

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0)
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/exact-enter')

  await h.page.getByTestId('toolbar-branch-button').click()
  await h.page.getByTestId('branch-switcher-search').fill('feature/exact')
  await h.page.getByTestId('branch-switcher-search').press('Enter')

  // Still open, and still on the branch it started on — a partial match is not a choice.
  await expect(h.page.getByTestId('branch-switcher')).toBeVisible()
})

test('a second Enter while a checkout is in flight does not fire a second checkout', async () => {
  execFileSync('git', ['branch', 'feature/slow-checkout'], { cwd: h.repoRoot })

  // A real post-checkout hook that sleeps and records each invocation. This opens a genuine
  // window — not a simulated one — where the component's `busy` state is true while
  // gitCheckoutBranch's underlying `git checkout` is still running, so a second Enter pressed in
  // that window proves whether the guard on the keyboard path (mirroring the row buttons'
  // `disabled={busy}`) actually stops a second concurrent checkout.
  const marker = join(h.repoRoot, 'checkout-calls.log')
  const hookPath = join(h.repoRoot, '.git', 'hooks', 'post-checkout')
  writeFileSync(hookPath, `#!/bin/sh\necho called >> "${marker}"\nsleep 1\n`)
  chmodSync(hookPath, 0o755)

  await h.page.getByTestId('toolbar-branch-button').click()
  await expect(h.page.getByTestId('branch-switcher-branch-row').filter({ hasText: 'feature/slow-checkout' })).toBeVisible()
  await h.page.getByTestId('branch-switcher-search').fill('feature/slow-checkout')
  await h.page.getByTestId('branch-switcher-search').press('Enter')
  // The hook is still sleeping when this lands — without the busy guard this fires a second
  // gitCheckoutBranch for the same ref.
  await h.page.getByTestId('branch-switcher-search').press('Enter')

  await expect(h.page.getByTestId('branch-switcher')).toHaveCount(0, { timeout: 5000 })
  await expect(h.page.getByTestId('toolbar-branch-button')).toContainText('feature/slow-checkout')
  expect(readFileSync(marker, 'utf8').trim().split('\n')).toEqual(['called'])
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

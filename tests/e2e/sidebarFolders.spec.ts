import { test, expect, type Locator } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchApiary, importAll, sidebarSession, type Harness } from './helpers'

/**
 * What a folder row offers beyond opening and closing: where it is on disk, folding away
 * everything beneath it, and getting the whole sidebar out of the way.
 */

let h: Harness

test.beforeEach(async () => {
  h = await launchApiary({ secondWorktree: true })
  await importAll(h.page)
  await h.page.getByTestId('sidebar-refresh').click()
})

test.afterEach(async () => { await h.close() })

const folder = (label: string): Locator =>
  h.page.locator('.project-row-wrap', { has: h.page.locator(`.project-label:text-is("${label}")`) })

test('hovering a worktree shows its full path, which can be copied from the card', async () => {
  const worktree = h.page.locator('.project-row-wrap[data-depth="1"]').first()
  const path = await worktree.getAttribute('data-folder-path')
  expect(path).not.toBeNull()

  await worktree.hover()
  const card = h.page.getByTestId('folder-hover-card')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('hover-card-path')).toHaveText(path!)

  // The card survives the trip from the row to its button.
  const copy = card.getByTestId('hover-card-copy-path')
  await copy.hover()
  await expect(card).toBeVisible()
  await copy.click()
  expect(await h.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(path)
})

test('a session\'s card can copy its folder\'s path too', async () => {
  await sidebarSession(h.page, 'Worktree session').hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()
  const path = await card.getByTestId('hover-card-path').textContent()
  await card.getByTestId('hover-card-copy-path').click()
  expect(await h.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(path)
})

test('collapse-all folds every worktree in a repository and leaves the repository open', async () => {
  const repo = folder('repo-c')
  const worktrees = h.page.locator('.project-row-wrap[data-depth="1"]')
  await expect(worktrees).toHaveCount(2)
  const openWorktrees = h.page.locator('.project-row-wrap[data-depth="1"] [data-testid="project-toggle"][aria-expanded="true"]')
  await expect(openWorktrees).toHaveCount(2)

  await repo.hover()
  await repo.getByTestId('collapse-all-button').click()

  await expect(openWorktrees).toHaveCount(0)
  // Still listed — folded, not hidden — under a repository that is still open.
  await expect(worktrees).toHaveCount(2)
  await expect(repo.getByTestId('project-toggle')).toHaveAttribute('aria-expanded', 'true')
  await expect(sidebarSession(h.page, 'Worktree session')).toHaveCount(0)
})

test('a folder with nothing beneath it has no collapse-all button', async () => {
  await expect(folder('work-a').getByTestId('collapse-all-button')).toHaveCount(0)
})

test('the sidebar hides to a rail and comes back, keeping what was typed into it', async () => {
  await h.page.getByTestId('search-input').fill('CSV')
  await h.page.getByTestId('sidebar-hide').click()
  await expect(h.page.getByTestId('sidebar')).toBeHidden()
  await expect(h.page.getByTestId('sidebar-resizer')).toHaveCount(0)
  const content = await h.page.getByTestId('content').boundingBox()
  // The sessions take the width: only the rail is left beside them.
  expect(content!.x).toBeLessThan(60)

  await h.page.getByTestId('sidebar-show').click()
  await expect(h.page.getByTestId('sidebar')).toBeVisible()
  await expect(h.page.getByTestId('sidebar-rail')).toHaveCount(0)
  await expect(h.page.getByTestId('search-input')).toHaveValue('CSV')
})

test('View > Toggle Sidebar hides and shows it, and hidden survives a reload', async () => {
  const toggle = async (): Promise<void> => {
    await h.app.evaluate(({ Menu }) => {
      const view = Menu.getApplicationMenu()!.items.find((i) => i.label === 'View')!
      const item = view.submenu!.items.find((i) => i.label === 'Toggle Sidebar')!
      // Electron types `MenuItem.click` as the bare `Function` type, so calling it directly is
      // an unsafe call as far as the type checker is concerned; it takes no arguments here.
      ;(item.click as () => void)()
    })
  }
  await toggle()
  await expect(h.page.getByTestId('sidebar-rail')).toBeVisible()
  await h.page.reload()
  await expect(h.page.getByTestId('sidebar-rail')).toBeVisible()
  await toggle()
  await expect(h.page.getByTestId('sidebar')).toBeVisible()
})

test('a folder\'s card pulls the latest of its branch into that worktree', async () => {
  // Give a fixture folder a real upstream, then have "someone else" push to it.
  const row = h.page.locator('.project-row-wrap[data-depth="0"]').first()
  const path = await row.getAttribute('data-folder-path')
  if (path === null) throw new Error('folder row has no path')
  const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString().trim()
  const branch = git(path, 'rev-parse', '--abbrev-ref', 'HEAD')
  const remote = mkdtempSync(join(h.home, 'upstream-'))
  git(remote, 'init', '-q', '--bare')
  git(path, 'remote', 'add', 'origin', remote)
  git(path, 'push', '-q', '-u', 'origin', branch)
  const teammate = mkdtempSync(join(h.home, 'teammate-'))
  git(teammate, 'clone', '-q', remote, '.')
  git(teammate, 'config', 'user.email', 't@example.com')
  git(teammate, 'config', 'user.name', 'Teammate')
  writeFileSync(join(teammate, 'from-teammate.txt'), 'hello')
  git(teammate, 'add', '.')
  git(teammate, 'commit', '-qm', 'teammate work')
  git(teammate, 'push', '-q')

  await row.hover()
  const card = h.page.getByTestId('folder-hover-card')
  await expect(card).toBeVisible()
  const pull = card.getByTestId('hover-card-pull-branch')
  await pull.hover()
  await pull.click()

  await expect(h.page.getByTestId('notification-message').last()).toContainText(/Pulled 1 commit into/)
  expect(git(path, 'log', '-1', '--format=%s')).toBe('teammate work')

  // A second pull has nothing to bring, and says so rather than claiming another success.
  await row.hover()
  await expect(card).toBeVisible()
  await card.getByTestId('hover-card-pull-branch').click()
  await expect(h.page.getByTestId('notification-message').last()).toContainText(/already up to date/)
})

test('a session\'s card offers no pull: its branch may be one it was recorded on, not today\'s checkout', async () => {
  await sidebarSession(h.page, 'Worktree session').hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()
  await expect(card.getByTestId('hover-card-pull-branch')).toHaveCount(0)
})

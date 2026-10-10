import { test, expect } from '@playwright/test'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { git, cloneInto, commitFile } from '../fixtures/gitRepo'
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

test('hovering a worktree shows its full path, which can be copied from the card', { tag: '@serial' }, async () => {
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

test('a session\'s card can copy its folder\'s path too', { tag: '@serial' }, async () => {
  await sidebarSession(h.page, 'Worktree session').hover()
  const card = h.page.getByTestId('session-hover-card')
  await expect(card).toBeVisible()
  const path = await card.getByTestId('hover-card-path').textContent()
  await card.getByTestId('hover-card-copy-path').click()
  expect(await h.app.evaluate(({ clipboard }) => clipboard.readText())).toBe(path)
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
  const branch = git(path, 'rev-parse', '--abbrev-ref', 'HEAD').trim()
  const remote = mkdtempSync(join(h.home, 'upstream-'))
  // The bare upstream's HEAD names the folder's branch, so the teammate's clone checks it out. With
  // a plain `init` its HEAD follows git's default branch, which differs between this machine's git
  // and CI's: there the teammate committed to another branch, and the pull found nothing.
  git(remote, 'init', '-q', '--bare', `--initial-branch=${branch}`)
  git(path, 'remote', 'add', 'origin', remote)
  git(path, 'push', '-q', '-u', 'origin', branch)
  const teammate = mkdtempSync(join(h.home, 'teammate-'))
  cloneInto(remote, teammate, { email: 't@example.com', name: 'Teammate' })
  commitFile(teammate, 'from-teammate.txt', 'teammate work', 'hello')
  git(teammate, 'push', '-q')

  await row.hover()
  const card = h.page.getByTestId('folder-hover-card')
  await expect(card).toBeVisible()
  const pull = card.getByTestId('hover-card-pull-branch')
  await pull.hover()
  await pull.click()

  await expect(h.page.getByTestId('notification-message').last()).toContainText(/Pulled 1 commit into/)
  expect(git(path, 'log', '-1', '--format=%s').trim()).toBe('teammate work')

  // A second pull has nothing to bring, and says so rather than claiming another success.
  await row.hover()
  await expect(card).toBeVisible()
  await card.getByTestId('hover-card-pull-branch').click()
  await expect(h.page.getByTestId('notification-message').last()).toContainText(/already up to date/)
})

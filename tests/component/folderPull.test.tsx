import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { STANDARD_SESSIONS as STD } from '../fixtures/standard'
import type { GitStatus } from '@shared/types'

function folderRow(label: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>('.project-row-wrap')]
    .find((r) => r.querySelector('.project-label')?.textContent === label)
}

async function rightClick(el: Element): Promise<void> {
  const { x, y, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2,
  }))
}

async function openFolderMenu(label: string): Promise<void> {
  await until(() => folderRow(label) !== undefined)
  const row = folderRow(label)
  if (row === undefined) throw new Error(`no sidebar folder "${label}"`)
  await rightClick(row)
}

const pullItem = (): HTMLButtonElement | null => document.querySelector<HTMLButtonElement>('[data-testid="context-menu-pull"]')
const toast = (): string => document.querySelector('[data-testid="notification-message"]')?.textContent ?? ''

// A worktree's "Pull" from the sidebar menu: its branch, fast-forwarded from upstream through the
// session in the folder, and disabled with the reason when there is nothing to pull from.
describe('pulling a worktree from the sidebar menu', () => {
  it('pulls the branch the worktree is on from its upstream, and says how many commits came in', async () => {
    const { fake } = await renderApp({}, (f) => {
      f.state.tracking.set('feature/wt', { upstream: true, ahead: 0, behind: 2, pending: 0 })
    })
    await openFolderMenu('repo-c-wt')
    await expect.poll(() => pullItem()?.disabled).toBe(false)
    await userEvent.click(page.getByTestId('context-menu-pull'))
    await expect.poll(toast).toBe('Pulled 2 commits into feature/wt.')
    expect(fake.callsTo('gitUpdateBranch')).toEqual([[{ kind: 'session', id: STD.worktree.id }, 'feature/wt']])
  })

  it('is disabled, saying why, while its branch is still being read', async () => {
    await renderApp({}, (f) => {
      f.override('gitStatus', () => new Promise<GitStatus>(() => undefined))
    })
    await openFolderMenu('repo-c-wt')
    await expect.poll(() => pullItem()?.title).toBe("Checking this worktree's branch…")
    expect(pullItem()?.disabled).toBe(true)
  })

  it('is disabled, saying why, when its branch cannot be read', async () => {
    await renderApp({}, (f) => {
      f.override('gitStatus', () => Promise.reject(new Error('not a repository')))
    })
    await openFolderMenu('repo-c-wt')
    await expect.poll(() => pullItem()?.title).toBe("Could not read this worktree's branch")
    expect(pullItem()?.disabled).toBe(true)
  })

  it('is disabled, saying why, when its branch has no upstream to pull from', async () => {
    await renderApp()
    await openFolderMenu('repo-c-wt')
    await expect.poll(() => pullItem()?.title).toBe('feature/wt has no upstream to pull from')
    expect(pullItem()?.disabled).toBe(true)
  })

  it('is disabled, saying why, when the worktree is not on a branch', async () => {
    await renderApp({}, (f) => {
      const worktree = f.state.projects.find((p) => p.path === '/fixture/repo-c-wt')
      if (worktree === undefined) throw new Error('no worktree in the fixture')
      worktree.detached = true
    })
    await openFolderMenu('repo-c-wt')
    await expect.poll(() => pullItem()?.title).toBe('This worktree is not on a branch')
    expect(pullItem()?.disabled).toBe(true)
  })

  it('is disabled, saying why, for a worktree with no session to pull through', async () => {
    await renderApp({ worktrees: { '/fixture/repo-c': [{ path: '/fixture/repo-quiet', branch: 'quiet' }] } })
    await openFolderMenu('repo-c')
    await userEvent.click(page.getByTestId('context-menu-show-all-worktrees'))
    await openFolderMenu('repo-quiet')
    await expect.poll(() => pullItem()?.title).toBe('Pulling needs a session in this worktree')
    expect(pullItem()?.disabled).toBe(true)
  })

  it('says why when the pull fails', async () => {
    await renderApp({}, (f) => {
      f.state.tracking.set('feature/wt', { upstream: true, ahead: 0, behind: 1, pending: 0 })
      f.override('gitUpdateBranch', () => Promise.reject(new Error('the remote hung up')))
    })
    await openFolderMenu('repo-c-wt')
    await expect.poll(() => pullItem()?.disabled).toBe(false)
    await userEvent.click(page.getByTestId('context-menu-pull'))
    await expect.poll(toast).toBe('Pull failed: the remote hung up')
  })

  it('is not offered for a folder git does not know', async () => {
    await renderApp()
    await openFolderMenu('work-a')
    await until(() => document.querySelector('[data-testid="context-menu-show-all-worktrees"]') !== null)
    expect(pullItem()).toBeNull()
  })
})

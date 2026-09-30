import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'

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

const WORKTREES = {
  '/fixture/repo-c': [
    { path: '/fixture/repo-c-wt', branch: 'feature/wt' },
    { path: '/fixture/repo-quiet', branch: 'quiet' },
  ],
}

describe('show all worktrees', () => {
  it('lists a worktree no session has run in, so one can be started there, and hides it again', async () => {
    const { fake } = await renderApp({ worktrees: WORKTREES })
    await until(() => folderRow('repo-c') !== undefined)
    expect(folderRow('repo-quiet')).toBeUndefined()

    await rightClick(folderRow('repo-c')!)
    const item = page.getByTestId('context-menu-show-all-worktrees')
    await expect.element(item).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(item)

    await until(() => folderRow('repo-quiet') !== undefined)
    const quiet = folderRow('repo-quiet')!
    expect(quiet.dataset.noSessions).toBe('true')
    expect(quiet.querySelector('.branch')?.textContent).toBe('quiet')
    // The worktree that already had sessions is still listed once, not twice.
    expect([...document.querySelectorAll('.project-label')].filter((el) => el.textContent === 'repo-c-wt')).toHaveLength(1)

    // A worktree is a git folder, so its "+" asks: a session here, or another worktree.
    await userEvent.click(quiet.querySelector<HTMLElement>('[data-testid="new-session-button"]')!)
    await userEvent.click(page.getByTestId('context-menu-new-session'))
    await until(() => fake.callsTo('newSessionInProject').length === 1)
    expect(fake.callsTo('newSessionInProject')[0]).toEqual(['/fixture/repo-quiet'])

    await rightClick(folderRow('repo-c')!)
    await expect.element(item).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(item)
    await until(() => folderRow('repo-quiet') === undefined)
    expect(folderRow('repo-c-wt')).toBeDefined()
  })

  it('says so when a folder has no other worktrees, rather than appearing to do nothing', async () => {
    await renderApp({ worktrees: WORKTREES })
    await until(() => folderRow('work-a') !== undefined)
    await rightClick(folderRow('work-a')!)
    await userEvent.click(page.getByTestId('context-menu-show-all-worktrees'))
    await expect.element(page.getByText('work-a has no other worktrees')).toBeVisible()
  })
})

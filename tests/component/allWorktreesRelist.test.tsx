/**
 * UI-11: `useAllWorktrees` depended on the whole `tree` array, which gets a new identity on every
 * `treeChanged` (about once a second while a session is live) — so with "Show all worktrees" on
 * for a folder, an unrelated tree refresh re-ran `listWorktrees` (a git process in main) for that
 * folder every single time, not just when the set of folders actually changed.
 */
import { describe, it, expect } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { nextFrames, stays, until } from './helpers'

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
  '/fixture/repo-c': [{ path: '/fixture/repo-c-wt', branch: 'feature/wt' }],
}

describe('useAllWorktrees re-listing (UI-11)', () => {
  it('does not re-list a shown folder\'s worktrees on a tree refresh that changes no folder', async () => {
    const { fake } = await renderApp({ worktrees: WORKTREES })
    await until(() => folderRow('repo-c') !== undefined)
    await rightClick(folderRow('repo-c')!)
    await userEvent.click(document.querySelector('[data-testid="context-menu-show-all-worktrees"]')!)
    await until(() => fake.callsTo('listWorktrees').length >= 1)
    const before = fake.callsTo('listWorktrees').length

    // Five tree refreshes with the same top-level folders — the common case: a live session's
    // transcript growing fires `treeChanged` without adding or removing a project.
    for (let i = 0; i < 5; i++) {
      fake.emit('treeChanged')
      await nextFrames(1)
    }

    // Measured against the pre-UI-11 code (keyed on the `tree` array's identity): 7 total calls
    // (2 before this loop + 5 more, one per unrelated refresh). After: still 2 — the folder set
    // never changed, so none of the five refreshes re-lists anything.
    await stays(() => fake.callsTo('listWorktrees').length === before, 50, 'no worktree re-list on an unrelated tree refresh')

    // The documented guarantee ("a worktree added or removed on disk shows up with the next
    // rescan") still holds for the one path that does not touch the folder set: the sidebar's own
    // explicit Refresh button, wired through `refreshNonce`.
    await userEvent.click(document.querySelector<HTMLElement>('[data-testid="sidebar-refresh"]')!)
    await until(() => fake.callsTo('listWorktrees').length > before)
    expect(fake.callsTo('listWorktrees').length).toBe(before + 1)
  })
})

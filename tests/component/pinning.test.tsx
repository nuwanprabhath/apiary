import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { clickRowAction, until } from './helpers'

function all(id: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
}
function within(root: Element, id: string): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
}
/** The wrapper around one sidebar row, by the session's title — the pin button's own parent. */
function row(title: string): HTMLElement {
  const el = all('session-item').find((e) => e.textContent?.includes(title))
  if (el === undefined) throw new Error(`No row for "${title}"`)
  return el.closest('.session-row-wrap') ?? el
}

describe('pinning', () => {
  it('pinning lifts a session to the top and unpinning puts it back', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    // Nothing pinned: no section at all, rather than an empty header taking up room.
    expect(all('pinned-section')).toHaveLength(0)

    await clickRowAction('Worktree session', 'pin-session-button')

    await until(() => all('pinned-section').length === 1)
    const section = all('pinned-section')[0]
    expect(within(section, 'session-item')).toHaveLength(1)
    expect(within(section, 'session-item')[0].textContent).toContain('Worktree session')

    // Moved, not copied: the row is gone from the folder it came from, so the sidebar never shows
    // the same session twice.
    expect(all('session-item')).toHaveLength(4)
    expect(all('session-item').filter((el) => el.textContent?.includes('Worktree session'))).toHaveLength(1)

    // The same button unpins, and the row goes back where it came from.
    const pinnedWrap = section.querySelector('.session-row-wrap')!
    await userEvent.click(within(pinnedWrap, 'pin-session-button')[0] ?? pinnedWrap)
    await until(() => all('pinned-section').length === 0)
    expect(all('session-item')).toHaveLength(4)
  })

  it('a pinned session opens like any other, and searching narrows the pinned list too', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    await clickRowAction('Worktree session', 'pin-session-button')
    await until(() => all('pinned-section').length === 1)
    await userEvent.click(within(all('pinned-section')[0], 'session-item')[0])
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Worktree session')

    // A pinned row that doesn't match the search would otherwise be the one row on screen that
    // ignores the search box.
    await userEvent.fill(page.getByTestId('search-input'), 'csv')
    await until(() => all('pinned-section').length === 0)
    await userEvent.fill(page.getByTestId('search-input'), 'worktree')
    await until(() => within(all('pinned-section')[0], 'session-item').length === 1)
  })

  it("a row's age gives way to its buttons on hover", async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    const target = row('Fix CSV export bug')
    // At rest: the age is what you scan the list by, and the buttons are out of the way.
    await expect.element(page.elementLocator(within(target, 'session-time')[0])).toBeVisible()
    expect(within(target, 'pin-session-button')[0].checkVisibility()).toBe(false)
    expect(within(target, 'split-session-button')[0].checkVisibility()).toBe(false)
    expect(within(target, 'delete-session-button')[0].checkVisibility()).toBe(false)

    await userEvent.hover(target)

    await until(() => !within(target, 'session-time')[0].checkVisibility())
    expect(within(target, 'pin-session-button')[0].checkVisibility()).toBe(true)
    expect(within(target, 'split-session-button')[0].checkVisibility()).toBe(true)
    expect(within(target, 'delete-session-button')[0].checkVisibility()).toBe(true)
  })

  it('removing a pinned session drops it from the pinned list as well as the tree', async () => {
    const { fake } = await renderApp()
    await until(() => all('session-item').length === 4)
    await clickRowAction('Worktree session', 'pin-session-button')
    await until(() => all('pinned-section').length === 1)

    const pinnedWrap = all('pinned-section')[0].querySelector('.session-row-wrap')!
    await userEvent.hover(pinnedWrap)
    await userEvent.click(within(pinnedWrap, 'delete-session-button')[0])
    await userEvent.click(page.getByTestId('delete-session-confirm'))
    // The real main process pushes this after removeSession resolves (src/main/ipc.ts); the fake
    // mutates its own state but leaves emitting it to the caller, same as it does for every other
    // write that the app expects a `treeChanged` push for.
    fake.emit('treeChanged')

    await until(() => all('pinned-section').length === 0)
    await until(() => all('session-item').length === 3)
    expect(all('session-item')).toHaveLength(3)
  })
})

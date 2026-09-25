import { describe, it, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { until } from './helpers'

/** A top-level folder row, addressed by the label on its own toggle — an element, not a locator,
 *  so it survives whatever the test does to the row afterwards. */
function folder(label: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('.project-row-wrap[data-depth="0"]')]
    .find((r) => r.querySelector('.project-label')?.textContent === label)
  if (row === undefined) throw new Error(`no top-level folder row for "${label}"`)
  return row
}

/**
 * The labels of the top-level folders, in the order they are drawn.
 *
 * Waits for at least one before reading: the tree arrives asynchronously, so reading the DOM
 * straight after mount can return an empty list.
 */
async function folderOrder(): Promise<string[]> {
  await until(() => document.querySelectorAll('.project-row-wrap[data-depth="0"] .project-label').length > 0)
  return [...document.querySelectorAll('.project-row-wrap[data-depth="0"] .project-label')].map((el) => el.textContent ?? '')
}

/** `onContextMenu` is a plain DOM handler; the real mouse has no right-click, so this dispatches
 *  the native event `userEvent` cannot reach. */
async function rightClick(el: Element): Promise<void> {
  const { x, y, width, height } = el.getBoundingClientRect()
  el.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true, cancelable: true, clientX: x + width / 2, clientY: y + height / 2,
  }))
}

describe('sidebarGroups', () => {
  it('a group collapses, so the folders filed under it are out of the way', async () => {
    await renderApp()
    const first = (await folderOrder())[0]
    await rightClick(folder(first))
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.keyboard('{Enter}')

    const group = page.getByTestId('folder-group')
    const row = () => [...document.querySelectorAll('[data-testid="folder-group"] .project-label')]
      .find((el) => el.textContent === first)
    await until(() => row() !== undefined)
    await userEvent.click(group.getByTestId('folder-group-toggle'))
    await until(() => row() === undefined)
    expect(row()).toBeUndefined()
  })

  it('deleting a group frees its folders instead of taking them with it', async () => {
    await renderApp()
    const names = await folderOrder()
    const first = names[0]

    await rightClick(folder(first))
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.keyboard('{Enter}')
    await until(() => page.getByTestId('folder-group').elements().length === 1)

    await rightClick(page.getByTestId('folder-group-toggle').element())
    await userEvent.click(page.getByTestId('context-menu-delete-group'))

    await until(() => page.getByTestId('folder-group').elements().length === 0)
    // The heading is gone; the folder it held is not.
    expect(await folderOrder()).toEqual(expect.arrayContaining([first]))
  })

  it('a group can be renamed from its own menu', async () => {
    await renderApp()
    const first = (await folderOrder())[0]
    await rightClick(folder(first))
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.fill(page.getByTestId('folder-group-rename'), 'Old name')
    await userEvent.keyboard('{Enter}')

    await rightClick(page.getByTestId('folder-group-toggle').element())
    await userEvent.click(page.getByTestId('context-menu-rename-group'))
    const rename = page.getByTestId('folder-group-rename')
    await userEvent.fill(rename, 'Archive')
    await userEvent.keyboard('{Enter}')

    await expect.element(page.getByTestId('folder-group-toggle')).toHaveTextContent('Archive')
  })

  it('a folder can be dropped into a group that is still empty', async () => {
    // The reported bug: an empty group is a heading and a line of placeholder text, and only the
    // heading accepted a drop — so filing the *first* folder into a new group, the case that needs
    // dragging most, had almost nothing to aim at.
    await renderApp()
    const names = await folderOrder()
    const [first, second] = names

    await rightClick(folder(first))
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.fill(page.getByTestId('folder-group-rename'), 'Unwanted')
    await userEvent.keyboard('{Enter}')

    // Empty it again, so the group on screen is the empty case.
    await rightClick(folder(first))
    await userEvent.click(page.getByTestId('context-menu-remove-from-group'))
    const group = page.getByTestId('folder-group')
    await expect.element(group.getByTestId('folder-group-empty')).toBeVisible()

    await userEvent.dragAndDrop(folder(second), group)
    await until(() => [...document.querySelectorAll('[data-testid="folder-group"] .project-label')]
      .some((el) => el.textContent === second))
    await expect.element(group.getByTestId('folder-group-empty')).not.toBeInTheDocument()
  })

  it('hovering a session row shows where it ran, on what branch, and when it was last active', async () => {
    // This was a `title` attribute to begin with, which made for a test that passed while the
    // feature was all but invisible: the OS tooltip takes a second to appear and is drawn in the
    // system style. The assertion is now that something is actually on screen.
    await renderApp()
    const row = [...document.querySelectorAll<HTMLElement>('[data-testid="session-item"]')]
      .find((el) => el.textContent?.includes('Worktree session') === true)
    if (row === undefined) throw new Error('no row for Worktree session')
    await userEvent.hover(row)

    await until(() => page.getByTestId('session-hover-card').elements().length === 1)
    const card = document.querySelector('[data-testid="session-hover-card"]') as HTMLElement
    expect(card.textContent).toContain('Worktree session')
    expect(card.textContent).toContain('repo-c-wt')
    expect(card.textContent).toContain('feature/wt')
    expect(card.textContent).toContain('Last active')

    // And it goes away again, rather than being left over the list.
    await userEvent.hover(page.getByTestId('search-input'))
    await until(() => page.getByTestId('session-hover-card').elements().length === 0)
  })

  it('a group\'s collapse-all folds every folder in it, and leaves the group open', async () => {
    // Reported as wanting the folder rows' collapse-all on groups too, to fold a whole group's
    // repositories — worktrees included — in one click.
    await renderApp()
    await rightClick(folder('repo-c'))
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.fill(page.getByTestId('folder-group-rename'), 'Other projects')
    await userEvent.keyboard('{Enter}')

    const group = [...document.querySelectorAll<HTMLElement>('section.folder-group')]
      .find((el) => el.textContent?.includes('Other projects') === true)
    if (group === undefined) throw new Error('no "Other projects" group')
    // repo-c holds two sessions: its own and its worktree's.
    await until(() => group.querySelectorAll('[data-testid="session-item"]').length === 2)

    const headerWrap = group.querySelector('.folder-group-header-wrap') as HTMLElement
    await userEvent.hover(headerWrap)
    const button = group.querySelector('[data-testid="group-collapse-all-button"]') as HTMLElement
    await expect.element(button).toBeVisible()
    await userEvent.click(button)

    await until(() => group.querySelectorAll('[data-testid="session-item"]').length === 0)
    // The group itself stays open, showing its folders closed.
    expect(group.querySelector('[data-testid="folder-group-toggle"]')?.getAttribute('aria-expanded')).toBe('true')
    expect([...group.querySelectorAll('.project-label')].some((el) => el.textContent === 'repo-c')).toBe(true)
    // Nothing outside the group was touched.
    const csvRow = [...document.querySelectorAll<HTMLElement>('[data-testid="session-item"]')]
      .find((el) => el.textContent?.includes('Fix CSV export bug') === true)
    expect(csvRow).not.toBeUndefined()
  })

  it('the counts on group headings line up with the Active, Pinned and Recent counts', async () => {
    await renderApp()
    const names = await folderOrder()
    await rightClick(folder(names[0]))
    await userEvent.click(page.getByTestId('context-menu-new-group'))
    await userEvent.fill(page.getByTestId('folder-group-rename'), 'Tools')
    await userEvent.keyboard('{Enter}')
    // Something in Recent, so a section count and a group count are both on screen.
    await userEvent.click(page.getByTestId('session-item').all()[0])
    await until(() => page.getByTestId('recent-section').elements().length > 0
      || page.getByTestId('active-header').elements().length > 0)

    const rights = [...document.querySelectorAll('.sidebar .pinned-count')]
      .map((el) => Math.round(el.getBoundingClientRect().right))
    expect(rights.length).toBeGreaterThanOrEqual(2)
    expect(Math.max(...rights) - Math.min(...rights)).toBeLessThanOrEqual(1)

    // Hovering a group heading swaps its count for the collapse-all button, in the same place.
    await userEvent.hover(page.getByTestId('folder-group-toggle'))
    await expect.element(page.getByTestId('group-collapse-all-button')).toBeVisible()
  })

  it('the search row stays put while the session list scrolls under it', async () => {
    await renderApp()
    const list = page.getByTestId('sidebar-list')
    // The fixtures fit on one screen; a tall block at the end stands in for a long session history.
    const filler = document.createElement('div')
    filler.style.height = '2000px'
    filler.style.flex = 'none'
    list.element().appendChild(filler)
    await until(() => list.element().scrollHeight > list.element().clientHeight + 40)
    const search = document.querySelector('.sidebar-header') as HTMLElement
    const before = search.getBoundingClientRect()

    await userEvent.hover(list)
    list.element().scrollTop += 2000
    list.element().dispatchEvent(new Event('scroll', { bubbles: true }))
    await until(() => list.element().scrollTop > 40)

    const after = search.getBoundingClientRect()
    expect(after.y).toBe(before.y)
    await expect.element(page.getByTestId('sidebar-refresh')).toBeVisible()
    const refresh = page.getByTestId('sidebar-refresh').element().getBoundingClientRect()
    expect(refresh.top).toBeGreaterThanOrEqual(0)
    expect(refresh.bottom).toBeLessThanOrEqual(window.innerHeight)
  })
})

import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { sidebarSession, until } from './helpers'

/** Every element with a given data-testid, document-wide. */
function all(id: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)]
}

/** The row wrap (session or folder) whose visible text contains `text` — session titles and
 *  folder labels are both unique in the fixture, so a substring match is enough. */
function treeitemWithText(text: string): HTMLElement {
  const el = [...document.querySelectorAll<HTMLElement>('[role="treeitem"]')]
    .find((e) => e.textContent?.includes(text) === true)
  if (el === undefined) throw new Error(`No treeitem for "${text}"`)
  return el
}

describe('sidebar tree: WAI-ARIA roles', () => {
  it('the folder/session hierarchy is one tree with levelled treeitems', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)

    const mainTree = document.querySelector('[role="tree"][aria-label="Sessions"]')
    expect(mainTree).not.toBeNull()

    const repoC = treeitemWithText('repo-c')
    expect(repoC.getAttribute('data-tree-kind')).toBe('folder')
    expect(repoC.getAttribute('aria-level')).toBe('1')
    expect(repoC.getAttribute('aria-expanded')).toBe('true')

    const repoRoot = treeitemWithText('Repo root session')
    expect(repoRoot.getAttribute('data-tree-kind')).toBe('session')
    expect(repoRoot.getAttribute('aria-level')).toBe('2')

    const worktreeFolder = treeitemWithText('repo-c-wt')
    expect(worktreeFolder.getAttribute('aria-level')).toBe('2')

    const worktreeSession = treeitemWithText('Worktree session')
    expect(worktreeSession.getAttribute('aria-level')).toBe('3')
  })

  it('row-action buttons are not Tab stops; the row itself is', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    const row = treeitemWithText('Fix CSV export bug')
    expect(row.getAttribute('tabindex')).not.toBeNull()
    for (const testId of ['note-session-button', 'pin-session-button', 'split-session-button', 'delete-session-button']) {
      const button = row.querySelector(`[data-testid="${testId}"]`)
      expect(button?.getAttribute('tabindex')).toBe('-1')
    }
  })
})

describe('sidebar tree: keyboard navigation', () => {
  it('Down/Up move the roving tab stop between treeitems in visible order', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    const repoC = treeitemWithText('repo-c')
    repoC.focus()
    expect(document.activeElement).toBe(repoC)

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(treeitemWithText('Repo root session'))

    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(treeitemWithText('repo-c-wt'))

    await userEvent.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(treeitemWithText('Repo root session'))
  })

  it('ArrowRight expands a collapsed folder without moving focus, then moves into it', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    const repoC = treeitemWithText('repo-c')
    // Collapse it first (it starts open), so expanding is the thing under test.
    repoC.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await until(() => repoC.getAttribute('aria-expanded') === 'false')
    await expect.element(sidebarSession('Repo root session')).not.toBeInTheDocument()

    await userEvent.keyboard('{ArrowRight}')
    await until(() => repoC.getAttribute('aria-expanded') === 'true')
    // Expanding alone does not move focus off the folder — a second ArrowRight moves into it.
    expect(document.activeElement).toBe(repoC)

    await userEvent.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(treeitemWithText('Repo root session'))
  })

  it('ArrowLeft on a session moves to its parent folder; on the parent, collapses it', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    const repoRoot = treeitemWithText('Repo root session')
    repoRoot.focus()

    await userEvent.keyboard('{ArrowLeft}')
    const repoC = treeitemWithText('repo-c')
    expect(document.activeElement).toBe(repoC)
    // Still expanded — the first ArrowLeft only moved focus, since a session has no expand state.
    expect(repoC.getAttribute('aria-expanded')).toBe('true')

    await userEvent.keyboard('{ArrowLeft}')
    expect(repoC.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(repoC)
  })

  it('Home/End jump to the first/last treeitem', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    treeitemWithText('repo-c-wt').focus()

    await userEvent.keyboard('{Home}')
    expect(document.activeElement).toBe(treeitemWithText('repo-c'))

    await userEvent.keyboard('{End}')
    expect(document.activeElement).toBe(treeitemWithText('Add worktree switcher'))
  })

  it('Enter on a session selects it; on a folder, toggles it', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    const workA = treeitemWithText('Fix CSV export bug')
    workA.focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('session-title')).toMatchTextContent('Fix CSV export bug')

    const repoC = treeitemWithText('repo-c')
    repoC.focus()
    await userEvent.keyboard('{Enter}')
    await until(() => repoC.getAttribute('aria-expanded') === 'false')
  })

  it('Shift+Enter splits the focused session into a new pane', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    const row = treeitemWithText('Fix CSV export bug')
    row.focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('session-title')).toMatchTextContent('Fix CSV export bug')

    row.focus()
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    await until(() => all('session-column').length === 2)
  })

  it('Shift+F10 opens the session context menu on the focused row', async () => {
    await renderApp()
    await until(() => all('session-item').length === 4)
    treeitemWithText('Fix CSV export bug').focus()
    await userEvent.keyboard('{Shift>}{F10}{/Shift}')
    await expect.element(page.getByTestId('sidebar-menu')).toBeVisible()
    await expect.element(page.getByText('Fork session')).toBeVisible()
  })
})

describe('sidebar tree: Pinned/Recent/Active are their own flat trees', () => {
  it('Pinned is a separate tree; Down moves within it and Enter selects', async () => {
    const { fake } = await renderApp()
    await until(() => all('session-item').length === 4)
    // Pin two sessions so there is somewhere for Down to go.
    const first = treeitemWithText('Fix CSV export bug').querySelector('[data-testid="pin-session-button"]')
    const second = treeitemWithText('Add worktree switcher').querySelector('[data-testid="pin-session-button"]')
    ;(first as HTMLElement).click()
    ;(second as HTMLElement).click()
    void fake
    await until(() => all('pinned-section').length === 1)

    const pinnedTree = document.querySelector('[role="tree"][aria-label="Pinned sessions"]')!
    const items = [...pinnedTree.querySelectorAll('[role="treeitem"]')] as HTMLElement[]
    expect(items).toHaveLength(2)
    const secondTitle = items[1].textContent?.includes('Fix CSV export bug') === true
      ? 'Fix CSV export bug' : 'Add worktree switcher'
    items[0].focus()
    await userEvent.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(items[1])
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('session-title')).toMatchTextContent(secondTitle)
  })
})

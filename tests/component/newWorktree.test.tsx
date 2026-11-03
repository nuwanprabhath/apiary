import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { HOVER_DELAY_MS } from '../../src/renderer/ui/HoverCard'
import { renderApp } from './renderApp'
import { fakeRef } from './fakeApiary'
import { mouse, stays } from './helpers'

/** The "+" of the folder row labelled `label` (a git repository in the fixture: repo-c). */
function plusOf(label: string): HTMLElement {
  const row = [...document.querySelectorAll<HTMLElement>('[data-testid="project-toggle"]')]
    .find((t) => t.querySelector('.project-label')?.textContent === label)
    ?.closest<HTMLElement>('.project-row-wrap')
  const button = row?.querySelector<HTMLElement>('[data-testid="new-session-button"]')
  if (button === null || button === undefined) throw new Error(`no "+" on ${label}`)
  return button
}

describe('"+" on a git folder', () => {
  it('offers a session here or a new worktree; a session is still one click away', async () => {
    const { fake } = await renderApp()
    await userEvent.click(plusOf('repo-c'))
    await expect.element(page.getByTestId('new-in-folder-menu')).toBeVisible()
    await userEvent.click(page.getByTestId('context-menu-new-session'))
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
    expect(fake.callsTo('newSessionInProject')).toEqual([['/fixture/repo-c']])
  })

  it('the menu stays clear of the path card, and its row stays highlighted while the pointer is on the menu', async () => {
    await renderApp()
    const plus = plusOf('repo-c')
    const row = plus.closest<HTMLElement>('.project-row-wrap')
    if (row === null) throw new Error('no row')
    const p = plus.getBoundingClientRect()
    await mouse.move(p.x + p.width / 2, p.y + p.height / 2, 4)
    await userEvent.click(plus)
    await expect.element(page.getByTestId('new-in-folder-menu')).toBeVisible()
    const item = page.getByTestId('context-menu-new-session').element().getBoundingClientRect()
    await mouse.move(item.x + item.width / 2, item.y + item.height / 2, 6)

    await stays(() => document.querySelector('[data-testid="folder-hover-card"]') === null, HOVER_DELAY_MS + 400, 'no path card over the menu')
    const probe = document.createElement('div')
    probe.style.background = 'var(--selected)'
    row.parentElement?.append(probe)
    const selected = getComputedStyle(probe).backgroundColor
    probe.remove()
    expect(getComputedStyle(row).backgroundColor).toBe(selected)
    expect(plus.getAttribute('aria-expanded')).toBe('true')
  })

  it('a non-git folder starts its session straight away, with no menu', async () => {
    const { fake } = await renderApp()
    await userEvent.click(plusOf('work-a'))
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
    expect(document.querySelector('[data-testid="new-in-folder-menu"]')).toBeNull()
    expect(fake.callsTo('newSessionInProject')).toEqual([['/fixture/work-a']])
  })

  it('a new worktree on an existing branch: name, then branch — and a checked-out branch is not offered', async () => {
    const { fake } = await renderApp({ refs: { local: [fakeRef('main'), fakeRef('feature/wt'), fakeRef('dev')] } })
    await userEvent.click(plusOf('repo-c'))
    await userEvent.click(page.getByTestId('context-menu-new-worktree'))
    await expect.element(page.getByTestId('new-worktree-dialog')).toBeVisible()

    await expect.element(page.getByTestId('new-worktree-next')).toBeDisabled()
    await userEvent.type(page.getByTestId('new-worktree-name'), 'a/b')
    const location = (): string => document.querySelector('[data-testid="new-worktree-location"]')?.textContent ?? ''
    await expect.poll(location).toMatch(/cannot contain slashes/)
    await userEvent.clear(page.getByTestId('new-worktree-name'))
    await userEvent.type(page.getByTestId('new-worktree-name'), 'species-list')
    await expect.poll(location).toContain('/fixture/repo-c.worktrees/species-list')
    await userEvent.keyboard('{Enter}')

    // `main` is checked out in the repository and `feature/wt` in its worktree — not pickable.
    const rows = page.getByTestId('new-worktree-local-row')
    await expect.element(rows.filter({ hasText: 'main' })).toBeDisabled()
    await expect.element(rows.filter({ hasText: 'feature/wt' })).toBeDisabled()
    await userEvent.click(rows.filter({ hasText: 'dev' }))

    await expect.poll(() => fake.callsTo('worktreeCreate')).toEqual([
      ['/fixture/repo-c', { name: 'species-list', branch: { kind: 'local', branch: 'dev' } }],
    ])
    await expect.element(page.getByTestId('new-worktree-dialog')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('terminal-session')).toBeVisible()
  })

  it('a new worktree on a new branch: base first, then a name that defaults to the folder\'s', async () => {
    const { fake } = await renderApp()
    await userEvent.click(plusOf('repo-c'))
    await userEvent.click(page.getByTestId('context-menu-new-worktree'))
    await userEvent.type(page.getByTestId('new-worktree-name'), 'topic')
    await userEvent.keyboard('{Enter}')
    await userEvent.click(page.getByTestId('new-worktree-new-branch'))
    await userEvent.click(page.getByTestId('new-worktree-local-row').filter({ hasText: 'main' }))
    await expect.element(page.getByTestId('new-worktree-branch-name')).toHaveValue('topic')
    await userEvent.click(page.getByTestId('new-worktree-create'))

    await expect.poll(() => fake.callsTo('worktreeCreate')).toEqual([
      ['/fixture/repo-c', { name: 'topic', branch: { kind: 'new', branch: 'topic', from: 'main' } }],
    ])
  })
})

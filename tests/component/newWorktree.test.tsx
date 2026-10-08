import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { fakeRef } from './fakeApiary'

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

import { describe, it, beforeEach, expect } from 'vitest'
import { page, userEvent } from '@vitest/browser/context'
import { renderApp } from './renderApp'
import { sidebarSession } from './helpers'

describe('renaming a session', () => {
  beforeEach(async () => {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
  })

  it('Escape cancels an in-progress rename without changing the title', async () => {
    await userEvent.click(page.getByTestId('session-title-edit'))
    const input = page.getByTestId('session-title-input')
    await userEvent.fill(input, 'Should not be saved')
    await userEvent.keyboard('{Escape}')

    await expect.element(page.getByTestId('session-title-input')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')
  })

  it('blurring the input commits the rename, same as Enter', async () => {
    await userEvent.click(page.getByTestId('session-title-edit'))
    await userEvent.fill(page.getByTestId('session-title-input'), 'Committed on blur')
    // The content's blank top edge — clear of the sidebar's resize strip, which reaches a few pixels in.
    await userEvent.click(page.getByTestId('content'), { position: { x: 20, y: 1 } })

    await expect.element(page.getByTestId('session-title-input')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Committed on blur')
  })

  it('opening the rename editor on a different session starts from that session\'s own title, not a leftover draft', async () => {
    // Clicking another session's row blurs the currently-focused input first, which commits it
    // (same as pressing Enter) — since nothing was typed, the commit is a same-value no-op, not a
    // rename. This exercises that path deliberately: open A's editor, leave it untouched, then
    // switch to B.
    await userEvent.click(page.getByTestId('session-title-edit'))
    await userEvent.click(sidebarSession('Add worktree switcher'))
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Add worktree switcher')

    // B's own editor must start from B's title, not whatever was last open for A (the `key`ed
    // remount in App.tsx is what guarantees this).
    await userEvent.click(page.getByTestId('session-title-edit'))
    await expect.element(page.getByTestId('session-title-input')).toHaveValue('Add worktree switcher')
    await userEvent.keyboard('{Escape}')

    // And switching back, A's own title is untouched by any of the above.
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await expect.element(page.getByTestId('session-title')).toHaveTextContent('Fix CSV export bug')
    await expect.element(page.getByTestId('session-title-input')).not.toBeInTheDocument()
  })
})

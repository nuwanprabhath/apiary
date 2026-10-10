import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { sidebarSession, until } from '../helpers'
import { reviewUi } from './review'

/** Narrow panes: nothing in a pane's header, tab strip or composer is cut off, at any width. */
async function openSplit(title: string, opts: { shell: boolean; settings?: Record<string, unknown> }): Promise<void> {
  await renderApp(opts.settings === undefined ? undefined : { settings: opts.settings })
  await userEvent.click(sidebarSession(title))
  await until(() => document.querySelector('[data-testid="transcript"]') !== null)
  if (opts.shell) await userEvent.click(page.getByTestId('shell-toggle'))
}

const split = async (): Promise<void> => {
  if (document.querySelectorAll('[data-testid="session-tab-bar"]').length < 2) {
    await userEvent.click(page.getByTestId('session-tab-split').first())
    await until(() => document.querySelectorAll('[data-testid="session-tab-bar"]').length >= 2)
  }
  // The pointer rests on the split button, whose hover opens the layout picker: put it away.
  await userEvent.unhover(page.getByTestId('session-tab-split').first())
  await userEvent.keyboard('{Escape}')
  await until(() => document.querySelector('[data-testid^="layout-zone"]') === null)
}

describe('UI narrow panes', () => {
  it('pane split narrow', async () => {
    await openSplit('Worktree session', { shell: true })
    await reviewUi('pane split narrow', { widths: [760, 900, 1400], open: split })
  })

  it('pane single narrow', async () => {
    await openSplit('Worktree session', { shell: true })
    await reviewUi('pane single narrow', { widths: [620] })
  })

  it('pane split chat mode', async () => {
    await openSplit('Fix CSV export bug', { shell: false, settings: { transcriptChat: true } })
    await reviewUi('pane split chat mode', { widths: [900], open: split })
  })
})

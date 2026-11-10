import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { openLayout, panes } from '../paneFoldSetup'
import { TITLES, card, collapse, markStatus, openThirds } from '../paneRailSetup'
import { reviewUi } from './review'
import { must, take } from '../must'

/**
 * Panes collapsed sideways to rails: the maintainer's three-column case, a side pane, the glow, a
 * rail listing every tab. The sidebar is hidden first: at the audit's 620 px floor a sidebar plus
 * the panes' minimum widths is wider than the window, which the app widens (useWindowFitsPanes)
 * and the test page cannot.
 */

const keysOf = (pane: Element): string[] =>
  [...pane.querySelectorAll('[data-testid="pane-rail-tab"]')].map((e) => e.getAttribute('data-key')!)

async function hideSidebar(): Promise<void> {
  await userEvent.click(page.getByTestId('sidebar-hide'))
  await until(() => document.querySelector('[data-testid="sidebar-show"]') !== null)
}

/** Two columns, the first holding every other session, the second one taken from its list. */
async function openHalves(): Promise<HTMLElement[]> {
  await openLayout('halves-h', TITLES)
  await userEvent.click(must(panes()[1]).querySelector<HTMLElement>('[data-testid="pane-filler-tab"]')!)
  await until(() => must(panes()[1]).getAttribute('data-placeholder') === 'false')
  return panes()
}

describe('UI pane rail', () => {
  it('three columns, first and third collapsed', async () => {
    await renderApp()
    const [first, , third] = take(await openThirds(), 3)
    await hideSidebar()
    await collapse(first)
    await collapse(third)
    await reviewUi('pane rail thirds first and third')
  })

  it('main and two on the right, main collapsed', async () => {
    await renderApp()
    await openLayout('main-right2', ['Fix CSV export bug', 'Add worktree switcher'])
    await hideSidebar()
    await collapse(must(panes()[0]))
    await reviewUi('pane rail main right2 main collapsed')
  })

  it('a rail glowing while a session works', async () => {
    const { fake } = await renderApp()
    const [first] = take(await openHalves(), 1)
    await hideSidebar()
    await collapse(first)
    // Again on every pass: a resize makes the window report its tabs, which the fake files as stopped.
    const open = (): Promise<void> => until(() => { markStatus(fake, must(keysOf(first)[0]), 'running'); return card(first).getAttribute('data-glow') === 'running' })
    await open()
    await reviewUi('pane rail glowing working', { open })
  })

  it('a rail glowing while a session needs the person', async () => {
    const { fake } = await renderApp()
    const [first] = take(await openHalves(), 1)
    await hideSidebar()
    await collapse(first)
    const open = (): Promise<void> => until(() => {
      markStatus(fake, must(keysOf(first)[0]), 'running')
      markStatus(fake, must(keysOf(first)[1]), 'waiting')
      return card(first).getAttribute('data-glow') === 'waiting'
    })
    await open()
    await reviewUi('pane rail glowing needs you', { open })
  })

  it('a rail listing every tab of a pane holding several', async () => {
    await renderApp()
    await openLayout('halves-h', TITLES)
    await hideSidebar()
    await collapse(must(panes()[0]))
    await reviewUi('pane rail many tabs')
  })
})

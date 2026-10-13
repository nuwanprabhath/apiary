import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { foldButton, markRunning, openLayout, panes } from '../paneFoldSetup'
import { reviewUi } from './review'

/** A pane folded down to its tab bar, idle and with something running, in the stacked layouts. */
async function foldPane(index: number): Promise<HTMLElement> {
  const pane = panes()[index]
  await userEvent.click(foldButton(pane)!)
  await until(() => pane.getAttribute('data-folded') === 'true')
  return pane
}

describe('UI pane collapse', () => {
  it('two rows, top folded', async () => {
    await renderApp()
    await openLayout('halves-v', ['Fix CSV export bug', 'Add worktree switcher'])
    await foldPane(0)
    await reviewUi('two rows top folded')
  })

  it('two rows, top folded while running', async () => {
    const { fake } = await renderApp()
    await openLayout('halves-v', ['Fix CSV export bug', 'Add worktree switcher'])
    const top = await foldPane(0)
    const key = top.getAttribute('data-session-key')!
    await until(() => {
      markRunning(fake, key)
      return top.getAttribute('data-pane-activity') === 'running'
    })
    await reviewUi('two rows top folded running')
  })

  it('grid, top-left folded', async () => {
    await renderApp()
    await openLayout('grid')
    await foldPane(0)
    await reviewUi('grid top left folded')
  })

  it('main and two on the right, top-right folded', async () => {
    await renderApp()
    await openLayout('main-right2')
    await foldPane(1)
    await reviewUi('main right2 top right folded')
  })
})

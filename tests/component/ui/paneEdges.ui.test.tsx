import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { markRunning, openLayout, panes } from '../paneFoldSetup'
import { reviewUi } from './review'

/** Two panes side by side: the left one's edge must look like the right one's, in every theme. */
async function twoColumns(): Promise<ReturnType<typeof renderApp>> {
  const app = await renderApp({ settings: { transcriptChat: true } })
  await openLayout('halves-h', ['Fix CSV export bug'])
  await until(() => document.querySelector('[data-testid="pane-filler"]') !== null)
  await userEvent.click(document.querySelector<HTMLElement>('[data-testid="pane-filler-session"]')!)
  await until(() => panes().length === 2)
  return app
}

describe('UI pane edges', () => {
  it('two columns, one tab each', async () => {
    await twoColumns()
    await reviewUi('pane edges two columns', { widths: [1000, 1400] })
  })

  it('two columns, the left one working', async () => {
    const { fake } = await twoColumns()
    const key = panes()[0].getAttribute('data-session-key')!
    await until(() => {
      markRunning(fake, key)
      return panes()[0].querySelector('.session-tab[data-activity="running"]') !== null
    })
    await reviewUi('pane edges left working', { widths: [1400] })
  })
})

import { describe, it } from 'vitest'
import { userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { regentStatus, withRegent } from '../residentFixtures'
import { reviewUi } from './review'

const popup = (): Element | null => document.querySelector('[data-testid="resident-popup"]')

async function openPopup(): Promise<void> {
  await until(() => document.querySelector('[data-testid="resident-badge-regent"]') !== null)
  await userEvent.click(document.querySelector('[data-testid="resident-badge-regent"]')!)
  await until(() => popup() !== null)
}

describe('the popup header with Restart', () => {
  it('idle, then busy asking "Restart?"', async () => {
    const { fake } = await renderApp({}, (f) => { withRegent(f) })
    await openPopup()
    await reviewUi('resident popup header restart idle', { widths: [620, 1000], within: popup })
    fake.emit('residentsChanged', [regentStatus('working', 'Searching sessions')])
    await until(() => document.querySelector('[data-testid="resident-popup-stop"]') !== null)
    await userEvent.click(document.querySelector('[data-testid="resident-popup-restart"]')!)
    await until(() => popup()!.textContent.includes('Restart? It stops the current reply.'))
    await reviewUi('resident popup header restart asking', { widths: [620, 1000], within: popup })
  })

  it('asleep', async () => {
    await renderApp({}, (f) => { withRegent(f, { enabled: false }) })
    await openPopup()
    await reviewUi('resident popup header restart asleep', { widths: [620, 1000], within: popup })
  })
})

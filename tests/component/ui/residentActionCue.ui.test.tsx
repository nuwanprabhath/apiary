import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { deskConfig, withMrDesk } from '../residentFixtures'
import { reviewUi } from './review'

const el = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`)

describe('a quick action while it runs', () => {
  it('the popup during "Reading the desk": the action chip and the working line', async () => {
    await renderApp({}, (f) => { withMrDesk(f); f.state.residentHeld.set('mr-desk', []) })
    await until(() => el('resident-badge-mr-desk') !== null)
    const r = el('resident-badge-mr-desk')!.getBoundingClientRect()
    el('resident-badge-mr-desk')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 4, clientY: r.top + 4 }))
    await until(() => el('resident-menu') !== null)
    await userEvent.click([...el('resident-menu')!.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((i) => i.textContent.trim() === 'Show the desk')!)
    await until(() => el('resident-working') !== null && el('resident-action') !== null)
    await reviewUi('resident popup reading the desk', { widths: [620, 1000], within: () => el('resident-popup') })
    await reviewUi('resident badge reading the desk', { widths: [620, 1000], within: () => el('resident-badge-mr-desk') })
  })

  it('Check now while the cycle runs', async () => {
    const { fake } = await renderApp({ settings: { residents: [deskConfig({ project: 'g/p', repoPath: '/code/app' })] } }, (f) => { f.state.residentHeld.set('mr-desk', []) })
    fake.emit('openSettingsDialog')
    await until(() => el('settings-dialog') !== null)
    await userEvent.click(page.getByTestId('settings-nav-residents'))
    await until(() => el('resident-check-now-mr-desk') !== null)
    await userEvent.click(page.getByTestId('resident-check-now-mr-desk'))
    await until(() => el('resident-check-now-mr-desk')!.textContent === 'Checking…')
    await reviewUi('resident settings checking now', { widths: [620, 1000], within: () => el('resident-check-now-mr-desk')!.closest('.resident-cycle') })
  })
})

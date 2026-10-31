import { describe, it, expect, afterEach } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { createRoot, type Root } from 'react-dom/client'
import type { ResidentConfig } from '@shared/domain/residents'
import { renderApp } from './renderApp'
import { until } from './helpers'
import { closeResidentPopup, useResidentPopup, type ResidentPopupState } from '../../src/renderer/state/residentPopup'

/** ⌘⇧Space and ⌘↵ in the search box: the popup state, and what the popup then sends. */
const regent: ResidentConfig = {
  id: 'regent', kind: 'regent', name: 'Regent', enabled: true, model: 'sonnet', digestModel: 'haiku',
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70, permissionMode: 'auto', digestLookback: null, options: {}, cycleEveryMinutes: null,
}

let probe: Root | null = null
let popup: ResidentPopupState = { openId: null, ask: null }
afterEach(() => { probe?.unmount(); probe = null; closeResidentPopup() })

function Probe(): null {
  popup = useResidentPopup()
  return null
}

/** Reads the popup state through the store, as the app's own components do. */
function watchPopup(): void {
  const host = document.createElement('div')
  document.body.append(host)
  probe = createRoot(host)
  probe.render(<Probe />)
}

const searchBox = (): HTMLInputElement => document.querySelector<HTMLInputElement>('[data-testid="search-input"]') as HTMLInputElement

describe('resident shortcuts', () => {
  it("Cmd+Shift+Space toggles the enabled resident's popup", async () => {
    watchPopup()
    await renderApp({ settings: { residents: [{ ...regent, id: 'off', enabled: false }, regent] } })
    await userEvent.keyboard('{Meta>}{Shift>} {/Shift}{/Meta}')
    await until(() => popup.openId === 'regent')
    await userEvent.keyboard('{Meta>}{Shift>} {/Shift}{/Meta}')
    await until(() => popup.openId === null)
    expect(popup.ask).toBeNull()
  })

  it('Cmd+Enter in search opens the popup with the query, and the box keeps its text', async () => {
    watchPopup()
    const { fake } = await renderApp({ settings: { residents: [regent] } })
    await userEvent.fill(page.getByTestId('search-input'), 'auth bug')
    expect(searchBox().title).toContain('asks Regent')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await until(() => fake.callsTo('residentSend').length === 1)
    expect(fake.callsTo('residentSend')[0]).toEqual(['regent', 'auth bug'])
    expect(popup.openId).toBe('regent')
    expect(popup.ask).toBeNull()
    expect(searchBox().value).toBe('auth bug')
  })

  it('Cmd+Enter does nothing extra with no enabled resident', async () => {
    watchPopup()
    await renderApp({ settings: { residents: [{ ...regent, enabled: false }] } })
    await userEvent.fill(page.getByTestId('search-input'), 'auth bug')
    expect(searchBox().title).toBe('')
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    expect(popup.ask).toBeNull()
    expect(popup.openId).toBeNull()
  })
})

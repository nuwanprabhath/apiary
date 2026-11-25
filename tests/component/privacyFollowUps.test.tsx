import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { REGENT_KIND } from '@shared/domain/residents'
import type { ResidentConfig, ResidentStatus } from '@shared/domain/residents'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { FakeApiary } from './fakeApiary'
import { deskConfig, mrDeskStatus } from './residentFixtures'

const el = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`)
const regent: ResidentConfig = {
  id: 'regent', kind: REGENT_KIND, name: 'Regent', enabled: true, model: 'sonnet', digestModel: 'haiku',
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70, permissionMode: 'auto', digestLookback: null, options: {}, cycleEveryMinutes: null,
}
const regentStatus = (extra: Partial<ResidentStatus> = {}): ResidentStatus => ({
  id: 'regent', kind: REGENT_KIND, name: 'Regent', enabled: true, state: 'idle', activity: null, onDuty: true,
  appearance: { glyph: 'bee', palette: 'gold', animation: 'halo' }, digest: null, digestPaused: null, attention: null, pending: null,
  permissions: [], quickActions: [], setupNeeded: null, cycle: null, ...extra,
})

async function open(section: string, residents: ResidentConfig[], arrange?: (f: FakeApiary) => void): Promise<FakeApiary> {
  const { fake } = await renderApp({ settings: { residents } }, arrange)
  fake.emit('openSettingsDialog')
  await until(() => el('settings-dialog') !== null)
  await userEvent.click(page.getByTestId(`settings-nav-${section}`))
  await until(() => el(`${section}-section`) !== null)
  return fake
}

describe('privacy follow-ups', () => {
  it('a card whose digest waits for consent says so and its button opens Privacy', async () => {
    const fake = await open('residents', [regent])
    fake.emit('residentsChanged', [regentStatus({ digestPaused: 'consent' })])
    await until(() => el('resident-digest-paused-regent') !== null)
    expect(el('resident-digest-paused-regent')?.textContent).toContain('Digest paused: needs your OK')
    await userEvent.click(page.getByTestId('resident-digest-paused-open-regent'))
    await until(() => el('privacy-section') !== null)
  })

  it('a cycle paused for consent says so on the card', async () => {
    const fake = await open('residents', [deskConfig({ project: 'a/b', repoPath: '/x' })])
    fake.emit('residentsChanged', [mrDeskStatus('idle', { cycle: { everyMinutes: 15, nextAt: null, running: false, paused: 'consent' } })])
    await until(() => el('resident-cycle-paused-mr-desk') !== null)
    expect(el('resident-cycle-paused-mr-desk')?.textContent).toContain('Paused: needs your OK in Settings → Privacy')
  })

  it('the digest consent dialog names the lookback: one month', async () => {
    await open('privacy', [{ ...regent, digestLookback: { amount: 1, unit: 'months' } }])
    await userEvent.click(page.getByTestId('privacy-allow-backgroundDigest'))
    await until(() => el('privacy-digest-scope') !== null)
    expect(el('privacy-digest-scope')?.textContent).toBe('This covers sessions from the last 1 month; change it on Regent\'s card.')
  })

  it('the digest consent dialog says all sessions when the lookback is null', async () => {
    await open('privacy', [regent])
    await userEvent.click(page.getByTestId('privacy-allow-backgroundDigest'))
    await until(() => el('privacy-digest-scope') !== null)
    expect(el('privacy-digest-scope')?.textContent).toContain('This covers all sessions')
  })

  it('the usage row says Allowed when the meter is allowed', async () => {
    await open('privacy', [], (f) => { f.state.usageConsent = 'allowed' })
    expect(el('privacy-row-usage')?.textContent).toContain('Allowed')
  })

  it('the usage row says Not allowed when it is denied', async () => {
    await open('privacy', [], (f) => { f.state.usageConsent = 'denied' })
    expect(el('privacy-row-usage')?.textContent).toContain('Not allowed')
  })
})

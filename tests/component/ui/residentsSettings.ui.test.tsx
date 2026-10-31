import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { ResidentConfig } from '@shared/domain/residents'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { FakeApiary } from '../fakeApiary'
import { deskConfig, withDeskFields } from '../residentFixtures'
import { reviewUi, type UiWidth } from './review'

const regent: ResidentConfig = {
  id: 'regent', kind: 'regent', name: 'Regent', enabled: true, model: 'sonnet', digestModel: 'haiku',
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70, permissionMode: 'auto', digestLookback: null, options: {}, cycleEveryMinutes: null,
}
const WIDTHS: UiWidth[] = [620, 1000]

async function openResidents(residents: ResidentConfig[], arrange?: (fake: FakeApiary) => void): Promise<Awaited<ReturnType<typeof renderApp>>> {
  const app = await renderApp({ settings: { residents } }, arrange)
  app.fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-residents'))
  await until(() => document.querySelector('[data-testid="residents-section"]') !== null)
  return app
}

/** Settings → Residents: the empty section, a card mid-digest, and a long name on an overnight range. */
describe('UI: Settings → Residents', () => {
  it('residents: empty with Add Regent', async () => {
    await openResidents([])
    await reviewUi('residents empty', { widths: WIDTHS })
  })

  it('residents: the MR desk with Check every and the next check', async () => {
    const now = new Date()
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 14, 45).getTime()
    await openResidents([deskConfig({ project: 'ternandsparrow/paratoo-fdcp', repoPath: '/code/paratoo' })], (f) => { f.state.residentNextCycle.set('mr-desk', next) })
    await until(() => document.querySelector('[data-testid="resident-next-check-mr-desk"]') !== null)
    document.querySelector('[data-testid="resident-cycle-mr-desk"]')!.scrollIntoView({ block: 'center' })
    await reviewUi('residents mr desk check every', { widths: WIDTHS })
  })

  it('residents: one card mid-digest', async () => {
    const { fake } = await openResidents([regent])
    fake.emit('residentsChanged', [{
      id: 'regent', kind: 'regent', name: 'Regent', enabled: true, state: 'working', activity: 'Reading', onDuty: true,
      appearance: { glyph: 'bee', palette: 'gold', animation: 'halo' }, digest: { done: 612, total: 840 }, attention: null, permissions: [], quickActions: [], setupNeeded: null, cycle: null,
    }])
    await until(() => (document.body.textContent ?? '').includes('Digested 612 of 840 sessions'))
    await reviewUi('residents mid-digest', { widths: WIDTHS })
  })

  it('residents: the MR desk option fields and Regent with a custom lookback', async () => {
    await openResidents(
      [{ ...regent, digestLookback: { amount: 45, unit: 'days' } }, deskConfig({ clone: '/Users/me/src/clients/very-long-group-name/merge-request-desk-clone' })],
      withDeskFields,
    )
    await until(() => document.querySelector('[data-testid="resident-option-mr-desk-project"]') !== null)
    await reviewUi('residents desk options and custom lookback', { widths: WIDTHS })
  })

  it('residents: overnight range, long name, custom model', async () => {
    await openResidents([{
      ...regent, name: 'Chief of Staff to the Whole Hive of Sessions', model: 'claude-custom-9',
      schedule: { days: [0, 6], start: '22:00', end: '06:30' },
    }])
    await reviewUi('residents overnight long name', { widths: WIDTHS })
  })
})

import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import type { FakeApiary } from '../fakeApiary'
import { REGENT_KIND } from '@shared/domain/residents'
import { reviewUi, type UiWidth } from './review'

const q = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`)
const WIDTHS: UiWidth[] = [620, 1000]

async function openPrivacy(arrange: (fake: FakeApiary) => void = () => undefined): Promise<FakeApiary> {
  const { fake } = await renderApp()
  arrange(fake)
  fake.emit('openSettingsDialog')
  await until(() => q('settings-dialog') !== null)
  await userEvent.click(page.getByTestId('settings-nav-privacy'))
  await until(() => q('privacy-section') !== null)
  return fake
}

describe('UI: Settings → Privacy', () => {
  it('privacy: strict on, nothing allowed', async () => {
    await openPrivacy()
    await reviewUi('privacy strict empty', { widths: WIDTHS })
  })

  it('privacy: migrated consents', async () => {
    await openPrivacy((f) => {
      f.state.settings = {
        ...f.state.settings,
        privacyConsents: { backgroundDigest: { grantedAt: Date.now(), source: 'migrated' }, slackBridge: { grantedAt: Date.now(), source: 'user' } },
      }
    })
    await reviewUi('privacy migrated', { widths: WIDTHS })
  })

  it('privacy: strict off', async () => {
    await openPrivacy((f) => { f.state.settings = { ...f.state.settings, gdprStrictMode: false } })
    await reviewUi('privacy strict off', { widths: WIDTHS })
  })

  it('privacy: the turn-off dialog', async () => {
    await openPrivacy()
    await userEvent.click(page.getByTestId('privacy-strict'))
    await until(() => q('privacy-consent-dialog') !== null)
    await reviewUi('privacy turn off dialog', { widths: WIDTHS })
  })

  it('privacy: one feature dialog', async () => {
    await openPrivacy()
    await userEvent.click(page.getByTestId('privacy-allow-gitlabLookups'))
    await until(() => q('privacy-consent-dialog') !== null)
    await reviewUi('privacy one feature dialog', { widths: WIDTHS })
  })

  it('privacy: digest dialog with the lookback line', async () => {
    const { fake } = await renderApp({ settings: { residents: [{
      id: 'regent', kind: REGENT_KIND, name: 'Regent', enabled: true, model: 'sonnet', digestModel: 'haiku',
      schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' }, pauseAboveUsagePercent: 70, permissionMode: 'auto',
      digestLookback: { amount: 1, unit: 'months' }, options: {}, cycleEveryMinutes: null,
    }] } })
    fake.emit('openSettingsDialog')
    await until(() => q('settings-dialog') !== null)
    await userEvent.click(page.getByTestId('settings-nav-privacy'))
    await until(() => q('privacy-section') !== null)
    await userEvent.click(page.getByTestId('privacy-allow-backgroundDigest'))
    await until(() => q('privacy-digest-scope') !== null)
    await reviewUi('privacy digest dialog lookback', { widths: WIDTHS })
  })

  it('privacy: withdraw confirm', async () => {
    await openPrivacy((f) => {
      f.state.settings = { ...f.state.settings, privacyConsents: { backgroundDigest: { grantedAt: Date.now(), source: 'user' } } }
    })
    await userEvent.click(page.getByTestId('privacy-withdraw-backgroundDigest'))
    await until(() => q('privacy-withdraw-dialog') !== null)
    await reviewUi('privacy withdraw confirm', { widths: WIDTHS })
  })

  it('privacy: purge dialog', async () => {
    await openPrivacy()
    await userEvent.click(page.getByTestId('privacy-purge'))
    await until(() => q('privacy-purge-dialog') !== null)
    await reviewUi('privacy purge dialog', { widths: WIDTHS })
  })

  it('privacy: purge result with one failure', async () => {
    const fake = await openPrivacy()
    fake.override('privacyPurge', async () => ({ removedBytes: 5_300_000, failed: [{ item: 'logs', reason: 'EACCES: permission denied, unlink logs/apiary.log' }] }))
    await userEvent.click(page.getByTestId('privacy-purge'))
    await until(() => q('privacy-purge-dialog') !== null)
    await userEvent.click(page.getByTestId('privacy-purge-confirm'))
    await until(() => q('privacy-purge-result') !== null)
    await reviewUi('privacy purge result', { widths: WIDTHS })
  })

  it('privacy: Glass theme', async () => {
    await openPrivacy()
    await reviewUi('privacy glass', { widths: [1000], themes: ['glass'] })
  })
})

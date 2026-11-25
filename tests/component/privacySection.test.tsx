import { describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { FakeApiary } from './fakeApiary'

const q = (testId: string): HTMLElement | null => document.querySelector(`[data-testid="${testId}"]`)

async function openPrivacy(arrange: (fake: FakeApiary) => void = () => undefined): Promise<FakeApiary> {
  const { fake } = await renderApp()
  arrange(fake)
  fake.emit('openSettingsDialog')
  await until(() => q('settings-dialog') !== null)
  await userEvent.click(page.getByTestId('settings-nav-privacy'))
  await until(() => q('privacy-section') !== null)
  return fake
}

describe('Settings → Privacy', () => {
  it('turning privacy mode off asks first; Cancel keeps it on and saves nothing', async () => {
    const fake = await openPrivacy()
    await userEvent.click(page.getByTestId('privacy-strict'))
    await until(() => q('privacy-consent-dialog') !== null)
    expect(document.activeElement).toBe(q('privacy-consent-cancel'))
    await userEvent.click(page.getByTestId('privacy-consent-cancel'))
    await until(() => q('privacy-consent-dialog') === null)
    expect(fake.callsTo('privacySetStrict')).toHaveLength(0)
    expect(q('privacy-strict')?.getAttribute('aria-checked')).toBe('true')
  })

  it('confirming turns privacy mode off', async () => {
    const fake = await openPrivacy()
    await userEvent.click(page.getByTestId('privacy-strict'))
    await until(() => q('privacy-consent-dialog') !== null)
    await userEvent.click(page.getByTestId('privacy-consent-allow'))
    await until(() => fake.callsTo('privacySetStrict').length === 1)
    expect(fake.callsTo('privacySetStrict')[0]).toEqual([false])
    await until(() => q('privacy-allow-slackBridge') === null)
  })

  it('Allow on a row grants that feature after the dialog', async () => {
    const fake = await openPrivacy()
    await userEvent.click(page.getByTestId('privacy-allow-slackBridge'))
    await until(() => q('privacy-consent-dialog') !== null)
    expect(q('privacy-consent-dialog')?.textContent).toContain('Allow Slack connection?')
    await userEvent.click(page.getByTestId('privacy-consent-allow'))
    await until(() => fake.callsTo('privacyGrant').length === 1)
    expect(fake.callsTo('privacyGrant')[0]).toEqual(['slackBridge'])
    await until(() => q('privacy-withdraw-slackBridge') !== null)
  })

  it('Withdraw with the box ticked also purges', async () => {
    const fake = await openPrivacy((f) => {
      f.state.settings = { ...f.state.settings, privacyConsents: { backgroundDigest: { grantedAt: Date.now(), source: 'user' } } }
    })
    await userEvent.click(page.getByTestId('privacy-withdraw-backgroundDigest'))
    await until(() => q('privacy-withdraw-purge') !== null)
    await userEvent.click(page.getByTestId('privacy-withdraw-purge'))
    await userEvent.click(page.getByTestId('privacy-withdraw-confirm'))
    await until(() => fake.callsTo('privacyRevoke').length === 1)
    expect(fake.callsTo('privacyRevoke')[0]).toEqual(['backgroundDigest', true])
  })

  it('the purge confirm is disabled with nothing checked and sends exactly the checked keys', async () => {
    const fake = await openPrivacy()
    await userEvent.click(page.getByTestId('privacy-purge'))
    await until(() => q('privacy-purge-dialog') !== null)
    for (const key of ['searchIndex', 'digests', 'logs', 'residentHistory', 'slackMessages', 'pastedImages', 'scheduledLogs']) {
      await userEvent.click(page.getByTestId(`privacy-purge-${key}`))
    }
    expect((q('privacy-purge-confirm') as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(page.getByTestId('privacy-purge-logs'))
    await userEvent.click(page.getByTestId('privacy-purge-confirm'))
    await until(() => q('privacy-purge-result') !== null)
    expect(fake.callsTo('privacyPurge')[0]).toEqual([{
      searchIndex: false, digests: false, logs: true, residentHistory: false,
      slackMessages: false, pastedImages: false, scheduledLogs: false, sessionMetadata: false,
    }])
  })

  it('the retention input saves at once', async () => {
    const fake = await openPrivacy()
    await userEvent.fill(page.getByTestId('privacy-retention'), '90')
    await until(() => fake.state.settings.dataRetentionDays === 90)
    expect(fake.state.settings.dataRetentionDays).toBe(90)
  })
})

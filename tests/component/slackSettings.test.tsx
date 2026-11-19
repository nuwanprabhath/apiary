import { describe, it, expect } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { SlackStatus } from '@shared/domain/slack'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { FakeApiary } from './fakeApiary'

const el = (id: string): HTMLElement | null => document.querySelector(`[data-testid="${id}"]`)
const field = (id: string): HTMLInputElement => el(id) as HTMLInputElement

async function openSlack(patch: Partial<SlackStatus> = {}): Promise<FakeApiary> {
  const { fake } = await renderApp({}, (f) => { f.state.slack = { ...f.state.slack, ...patch } })
  fake.emit('openSettingsDialog')
  await until(() => el('settings-dialog') !== null)
  await userEvent.click(page.getByTestId('settings-nav-slack'))
  await until(() => el('slack-section') !== null && el('slack-status') !== null)
  return fake
}

describe('Settings → Slack', () => {
  it('shows the connection state main reports, and follows slackChanged', async () => {
    const fake = await openSlack()
    expect(el('slack-status')?.textContent).toBe('Off.')
    fake.emit('slackChanged', {
      ...fake.state.slack, enabled: true, hasToken: true, channel: { id: 'C1', name: 'work' }, bot: { userId: 'UB', name: 'regent' }, connection: 'connected',
    })
    await until(() => el('slack-status')?.textContent === 'Connected as @regent in #work.')
    fake.emit('slackChanged', { ...fake.state.slack, connection: 'error', error: 'The bot is not in #work.' })
    await until(() => el('slack-status')?.textContent === 'The bot is not in #work.')
  })

  it('saving a token sends it once and the field is cleared, never shown again', async () => {
    const fake = await openSlack()
    await userEvent.fill(page.getByTestId('slack-token'), 'xoxb-123-abc')
    await userEvent.click(page.getByTestId('slack-token-save'))
    await until(() => el('slack-token-saved') !== null)
    expect(fake.callsTo('slackConfigure')).toEqual([[{ token: 'xoxb-123-abc' }]])
    expect(document.body.innerHTML).not.toContain('xoxb-123-abc')
    await userEvent.click(page.getByTestId('slack-token-replace'))
    await until(() => el('slack-token') !== null)
    expect(field('slack-token').value).toBe('')
  })

  it('a channel is saved on Enter and on blur, and only when changed', async () => {
    const fake = await openSlack()
    await userEvent.click(page.getByTestId('slack-channel'))
    await userEvent.keyboard('{Tab}')
    expect(fake.callsTo('slackConfigure')).toHaveLength(0)
    await userEvent.fill(page.getByTestId('slack-channel'), '#work')
    await userEvent.keyboard('{Enter}')
    await until(() => field('slack-channel').value === '#work')
    await userEvent.keyboard('{Tab}')
    expect(fake.callsTo('slackConfigure')).toEqual([[{ channel: '#work' }]])
    await userEvent.fill(page.getByTestId('slack-owner'), 'UABC123')
    await userEvent.keyboard('{Tab}')
    await until(() => fake.callsTo('slackConfigure').length === 2)
    expect(fake.callsTo('slackConfigure')[1]).toEqual([{ ownerId: 'UABC123' }])
  })

  it("a refused save shows main's error under the field", async () => {
    const fake = await openSlack()
    fake.override('slackConfigure', async () => { throw new Error('Slack has no channel #nowhere.') })
    await userEvent.fill(page.getByTestId('slack-channel'), '#nowhere')
    await userEvent.keyboard('{Enter}')
    await until(() => el('slack-channel-error') !== null)
    expect(el('slack-channel-error')?.textContent).toContain('Slack has no channel')
  })

  it('without a keychain the token field is disabled and says why', async () => {
    await openSlack({ canStoreToken: false })
    expect(field('slack-token').disabled).toBe(true)
    expect(el('slack-no-keychain')?.textContent).toContain('no keychain')
  })

  it('Test connection asks main to test', async () => {
    const fake = await openSlack()
    await userEvent.click(page.getByTestId('slack-test'))
    await until(() => fake.callsTo('slackTest').length === 1)
    expect(fake.callsTo('slackTest')).toHaveLength(1)
  })

  it("the dialog's Save does not send any Slack field", async () => {
    const fake = await openSlack()
    await userEvent.click(page.getByTestId('settings-save'))
    await until(() => el('settings-dialog') === null)
    expect(fake.callsTo('slackConfigure')).toHaveLength(0)
    expect(JSON.stringify(fake.callsTo('settingsSet'))).not.toMatch(/slack|xoxb/i)
  })
})

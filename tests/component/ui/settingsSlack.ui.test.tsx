import { describe, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { SlackStatus } from '@shared/domain/slack'
import { renderApp } from '../renderApp'
import { until } from '../helpers'
import { reviewUi, type UiWidth } from './review'

const WIDTHS: UiWidth[] = [620, 1000]
const CONNECTED: Partial<SlackStatus> = {
  enabled: true, hasToken: true, channel: { id: 'C1', name: 'work' }, ownerId: 'U0123ABCD',
  bot: { userId: 'UB', name: 'regent' }, connection: 'connected',
}

async function openSlack(patch: Partial<SlackStatus>): Promise<void> {
  const { fake } = await renderApp({}, (f) => { f.state.slack = { ...f.state.slack, ...patch } })
  fake.emit('openSettingsDialog')
  await until(() => document.querySelector('[data-testid="settings-dialog"]') !== null)
  await userEvent.click(page.getByTestId('settings-nav-slack'))
  await until(() => document.querySelector('[data-testid="slack-status"]') !== null)
}

describe('UI: Settings → Slack', () => {
  it('slack settings off and empty', async () => {
    await openSlack({})
    await reviewUi('slack settings off', { widths: WIDTHS })
  })
  it('slack settings connected', async () => {
    await openSlack(CONNECTED)
    await reviewUi('slack settings connected', { widths: WIDTHS })
  })
  it('slack settings error', async () => {
    await openSlack({
      ...CONNECTED, connection: 'error', bot: null,
      error: 'The bot is not in #work, so Regent cannot read it. Invite it there with /invite @regent, then choose Test connection to try again.',
    })
    await reviewUi('slack settings error', { widths: WIDTHS })
  })
  it('slack settings without a keychain', async () => {
    await openSlack({ canStoreToken: false })
    await reviewUi('slack settings no keychain', { widths: WIDTHS })
  })
  it('slack settings replacing the token', async () => {
    await openSlack(CONNECTED)
    await userEvent.click(page.getByTestId('slack-token-replace'))
    await until(() => document.querySelector('[data-testid="slack-token"]') !== null)
    await reviewUi('slack settings replacing', { widths: WIDTHS })
  })
})

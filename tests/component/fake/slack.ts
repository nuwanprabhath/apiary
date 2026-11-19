/**
 * The Slack connection in the fake, modelled on `SlackBridge` (src/main/slack): a change is saved
 * (the token is never kept or returned, only `hasToken`), a channel is resolved against the one
 * channel this Slack has (`#work`), a machine with no keychain refuses a token, an enabled and
 * complete setup answers `connected`, and every change tells every window with `slackChanged`.
 * `tests/contract/clauses/slack.ts` pins it.
 */
import type { ApiaryApi } from '@shared/api'
import type { SlackStatus } from '@shared/domain/slack'
import type { Env } from './state'

type SlackApiFake = Pick<ApiaryApi, 'slackStatus' | 'slackConfigure' | 'slackTest'>

export const FAKE_SLACK_CHANNEL = { id: 'C0FAKE001', name: 'work' }
const BOT = { userId: 'UBOT0001', name: 'regent' }

export function slackApi(env: Env): SlackApiFake {
  const { state, emit } = env
  const set = (next: SlackStatus): SlackStatus => {
    state.slack = next
    emit('slackChanged', next)
    return next
  }
  const settle = (s: SlackStatus): SlackStatus => {
    if (!s.enabled) return { ...s, connection: 'off', error: null }
    if (!s.hasToken) return { ...s, connection: 'error', error: 'Add the bot token to connect.' }
    if (s.channel === null) return { ...s, connection: 'error', error: 'Choose the channel for this machine.' }
    if (s.ownerId === null) return { ...s, connection: 'error', error: 'Enter your Slack member id.' }
    return { ...s, bot: BOT, connection: 'connected', error: null }
  }
  return {
    slackStatus: async () => state.slack,
    slackConfigure: async (change) => {
      let next = { ...state.slack }
      if (change.token !== undefined) {
        if (!next.canStoreToken) throw new Error('This machine has no keychain to keep the Slack token in.')
        next = { ...next, hasToken: true, bot: null }
      }
      if (change.ownerId !== undefined) next = { ...next, ownerId: change.ownerId }
      if (change.enabled !== undefined) next = { ...next, enabled: change.enabled }
      let channelError: string | null = null
      if (change.channel !== undefined) {
        const wanted = change.channel.replace(/^#/, '')
        if (wanted === FAKE_SLACK_CHANNEL.id || wanted === FAKE_SLACK_CHANNEL.name) next = { ...next, channel: { ...FAKE_SLACK_CHANNEL } }
        else channelError = `Slack has no channel ${change.channel}, or the bot cannot see it. Invite it with /invite @regent.`
      }
      next = settle(next)
      return set(channelError === null ? next : { ...next, connection: 'error', error: channelError })
    },
    slackTest: async () => set(settle(state.slack)),
  }
}

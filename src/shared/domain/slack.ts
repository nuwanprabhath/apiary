import { isRecord } from '../guards'

export interface SlackStatus {
  enabled: boolean
  hasToken: boolean
  /** False on a machine with no keychain: a token cannot be saved. */
  canStoreToken: boolean
  channel: { id: string; name: string } | null
  /** The Slack member id whose messages are instructions. */
  ownerId: string | null
  /** Who the token is, from `auth.test`; null until a test or a first cycle succeeded. */
  bot: { userId: string; name: string } | null
  connection: 'off' | 'connecting' | 'connected' | 'error'
  /** One sentence a person can act on ("The bot is not in #work. Invite it with /invite @Regent."). */
  error: string | null
}

/** What Settings changes; an absent field is unchanged. `channel` is a name (with or without #) or an id. */
export interface SlackConfigChange { token?: string; channel?: string; ownerId?: string; enabled?: boolean }

const BOT_TOKEN = /^xoxb-[A-Za-z0-9-]+$/
const MEMBER_ID = /^[UW][A-Z0-9]{2,20}$/

export function isSlackConfigChange(value: unknown): value is SlackConfigChange {
  if (!isRecord(value)) return false
  const { token, channel, ownerId, enabled } = value
  if (token !== undefined && !(typeof token === 'string' && token.length >= 1 && token.length <= 200 && BOT_TOKEN.test(token))) return false
  if (channel !== undefined && !(typeof channel === 'string' && channel.length >= 1 && channel.length <= 80)) return false
  if (ownerId !== undefined && !(typeof ownerId === 'string' && MEMBER_ID.test(ownerId))) return false
  return enabled === undefined || typeof enabled === 'boolean'
}

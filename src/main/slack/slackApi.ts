import { isRecord } from '@shared/guards'

export interface SlackMessage {
  ts: string
  /** The parent's ts for a reply; null for a top-level message. */
  thread: string | null
  user: string | null
  botId: string | null
  subtype: string | null
  text: string
  /** On a thread parent: the ts of its newest reply. */
  latestReply: string | null
}

export interface SlackApi {
  authTest(): Promise<{ userId: string; name: string }>
  findChannel(nameOrId: string): Promise<{ id: string; name: string } | null>
  history(channel: string, limit: number): Promise<SlackMessage[]>
  replies(channel: string, thread: string, oldest: string | null): Promise<SlackMessage[]>
  /** Resolves with the new message's ts. */
  post(channel: string, text: string, thread: string | null): Promise<string>
  /** Already there is not an error. */
  react(channel: string, ts: string, name: string): Promise<void>
  /** Not there is not an error. */
  unreact(channel: string, ts: string, name: string): Promise<void>
}

/** A Slack error: `code` is Slack's own (`not_in_channel`), `network` or `http_<status>`. */
export class SlackApiError extends Error {
  readonly code: string
  readonly retryAfterMs: number | null
  /** Slack's `needed` scope for `missing_scope`. */
  readonly needed: string | null

  constructor(code: string, retryAfterMs: number | null = null, needed: string | null = null) {
    super(`Slack: ${code}`)
    this.name = 'SlackApiError'
    this.code = code
    this.retryAfterMs = retryAfterMs
    this.needed = needed
  }
}

/** One sentence a person can act on. `channel` and `bot` name what the sentence is about. */
export function describeSlackError(error: unknown, about: { channel?: string | null; bot?: string | null } = {}): string {
  if (!(error instanceof SlackApiError)) return 'Slack did not answer as expected.'
  switch (error.code) {
    case 'invalid_auth': case 'token_revoked': case 'account_inactive': case 'not_authed': return 'Slack refused the token.'
    case 'not_in_channel': case 'channel_not_found': {
      const channel = about.channel === undefined || about.channel === null ? 'the channel' : `#${about.channel}`
      return `The bot is not in ${channel}. Invite it with /invite @${about.bot ?? 'regent'}.`
    }
    case 'missing_scope': return error.needed === null ? 'The Slack app is missing a permission (scope).' : `The Slack app is missing the ${error.needed} scope.`
    case 'network': return 'Could not reach Slack.'
    case 'ratelimited': return 'Slack is rate limiting this app; waiting.'
    default: return `Slack answered with an error (${error.code}).`
  }
}

interface ApiOptions { fetch: typeof fetch; baseUrl: string; token: () => Promise<string | null> }

const stringOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null)

function parseSlackMessage(raw: unknown): SlackMessage | null {
  if (!isRecord(raw) || typeof raw.ts !== 'string') return null
  const parent = stringOrNull(raw.thread_ts)
  return {
    ts: raw.ts,
    thread: parent !== null && parent !== raw.ts ? parent : null,
    user: stringOrNull(raw.user),
    botId: stringOrNull(raw.bot_id),
    subtype: stringOrNull(raw.subtype),
    text: stringOrNull(raw.text) ?? '',
    latestReply: stringOrNull(raw.latest_reply),
  }
}

/** A reaction call whose wanted state already holds (`already_reacted`, `no_reaction`) succeeded. */
async function settled(call: Promise<unknown>, alreadyCode: string): Promise<void> {
  try {
    await call
  } catch (e) {
    if (!(e instanceof SlackApiError && e.code === alreadyCode)) throw e
  }
}

export function createSlackApi(o: ApiOptions): SlackApi {
  async function call(method: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const token = await o.token()
    if (token === null) throw new SlackApiError('not_authed')
    let response: Response
    try {
      response = await o.fetch(`${o.baseUrl}/${method}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
        body: new URLSearchParams(params).toString(),
      })
    } catch {
      throw new SlackApiError('network')
    }
    if (response.status === 429) {
      const seconds = Number(response.headers.get('Retry-After'))
      throw new SlackApiError('ratelimited', (Number.isFinite(seconds) && seconds > 0 ? seconds : 30) * 1000)
    }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      throw new SlackApiError(`http_${String(response.status)}`)
    }
    if (!isRecord(body)) throw new SlackApiError(`http_${String(response.status)}`)
    if (body.ok !== true) throw new SlackApiError(stringOrNull(body.error) ?? 'unknown', null, stringOrNull(body.needed))
    return body
  }

  const messages = (body: Record<string, unknown>): SlackMessage[] =>
    (Array.isArray(body.messages) ? body.messages : []).flatMap((m: unknown) => { const x = parseSlackMessage(m); return x === null ? [] : [x] })

  return {
    async authTest() {
      const body = await call('auth.test', {})
      return { userId: stringOrNull(body.user_id) ?? '', name: stringOrNull(body.user) ?? '' }
    },
    async findChannel(nameOrId) {
      const wanted = nameOrId.replace(/^#/, '')
      let cursor = ''
      for (let page = 0; page < 50; page++) {
        const body = await call('conversations.list', {
          types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200', ...(cursor === '' ? {} : { cursor }),
        })
        for (const c of Array.isArray(body.channels) ? body.channels : []) {
          if (isRecord(c) && typeof c.id === 'string' && typeof c.name === 'string' && (c.id === wanted || c.name === wanted)) return { id: c.id, name: c.name }
        }
        cursor = isRecord(body.response_metadata) ? stringOrNull(body.response_metadata.next_cursor) ?? '' : ''
        if (cursor === '') return null
      }
      return null
    },
    async history(channel, limit) {
      return messages(await call('conversations.history', { channel, limit: String(limit) }))
    },
    async replies(channel, thread, oldest) {
      const body = await call('conversations.replies', { channel, ts: thread, limit: '200', ...(oldest === null ? {} : { oldest }) })
      return messages(body).filter((m) => m.ts !== thread)
    },
    async post(channel, text, thread) {
      const body = await call('chat.postMessage', { channel, text, ...(thread === null ? {} : { thread_ts: thread }) })
      const ts = stringOrNull(body.ts)
      if (ts === null) throw new SlackApiError('no_ts')
      return ts
    },
    async react(channel, ts, name) {
      await settled(call('reactions.add', { channel, timestamp: ts, name }), 'already_reacted')
    },
    async unreact(channel, ts, name) {
      await settled(call('reactions.remove', { channel, timestamp: ts, name }), 'no_reaction')
    },
  }
}

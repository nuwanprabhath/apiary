import { SlackApiError, type SlackApi, type SlackMessage } from '../../src/main/slack/slackApi'

export interface FakeSlack extends SlackApi {
  readonly channel: { id: string; name: string }
  readonly owner: string
  /** The owner posts; `thread` makes it a reply. Returns its ts. `agoMs` back-dates it. */
  ownerSays(text: string, o?: { thread?: string; agoMs?: number }): string
  /** Someone else, or a bot, posts. */
  otherSays(text: string, o?: { thread?: string; user?: string; bot?: boolean }): string
  /** Every post the token made, oldest first. */
  posts(): { ts: string; thread: string | null; text: string }[]
  reactions(): { ts: string; name: string }[]
  /** How often each method was called. */
  calls(): Record<string, number>
  /** The next call of `method` fails with this Slack error (`ratelimited` takes `retryAfterMs`). */
  failNext(method: string, code: string, retryAfterMs?: number): void
}

const BOT = 'UBOT0001'

/** An in-memory Slack: one channel, one owner, the bot. Timestamps are Slack's form and strictly increasing. */
export function fakeSlack(o: { now?: () => number } = {}): FakeSlack {
  const now = o.now ?? Date.now
  const channel = { id: 'C0FAKE001', name: 'work' }
  const owner = 'UOWNER001'
  const messages: SlackMessage[] = []
  const calls: Record<string, number> = {}
  const failures = new Map<string, { code: string; retryAfterMs: number | null }[]>()
  const reactions: { ts: string; name: string }[] = []
  let last = 0

  const stamp = (agoMs = 0): string => {
    const micros = Math.max(last + 1, (now() - agoMs) * 1000)
    last = micros
    const seconds = Math.floor(micros / 1_000_000)
    return `${String(seconds)}.${String(Math.floor(micros % 1_000_000)).padStart(6, '0')}`
  }
  const enter = (method: string): void => {
    calls[method] = (calls[method] ?? 0) + 1
    const failure = failures.get(method)?.shift()
    if (failure !== undefined) throw new SlackApiError(failure.code, failure.retryAfterMs)
  }
  const add = (m: Omit<SlackMessage, 'latestReply'>): string => {
    messages.push({ ...m, latestReply: null })
    if (m.thread !== null) {
      const parent = messages.find((p) => p.ts === m.thread)
      if (parent !== undefined) parent.latestReply = m.ts
    }
    return m.ts
  }
  const byTsDesc = (a: SlackMessage, b: SlackMessage): number => (a.ts < b.ts ? 1 : -1)

  return {
    channel, owner,
    ownerSays: (text, opts = {}) => add({ ts: stamp(opts.agoMs), thread: opts.thread ?? null, user: owner, botId: null, subtype: null, text }),
    otherSays: (text, opts = {}) => add({
      ts: stamp(), thread: opts.thread ?? null, user: opts.user ?? 'UOTHER001', botId: opts.bot === true ? 'B0OTHER01' : null, subtype: null, text,
    }),
    posts: () => messages.filter((m) => m.user === BOT).map((m) => ({ ts: m.ts, thread: m.thread, text: m.text })),
    reactions: () => [...reactions],
    calls: () => ({ ...calls }),
    failNext: (method, code, retryAfterMs) => {
      failures.set(method, [...(failures.get(method) ?? []), { code, retryAfterMs: retryAfterMs ?? null }])
    },
    authTest: async () => { enter('authTest'); return { userId: BOT, name: 'regent' } },
    findChannel: async (nameOrId) => {
      enter('findChannel')
      const wanted = nameOrId.replace(/^#/, '')
      return wanted === channel.id || wanted === channel.name ? { ...channel } : null
    },
    history: async (id, limit) => {
      enter('history')
      if (id !== channel.id) throw new SlackApiError('channel_not_found')
      return messages.filter((m) => m.thread === null).sort(byTsDesc).slice(0, limit).map((m) => ({ ...m }))
    },
    replies: async (id, thread, oldest) => {
      enter('replies')
      if (id !== channel.id) throw new SlackApiError('channel_not_found')
      return messages.filter((m) => m.thread === thread && (oldest === null || m.ts > oldest)).map((m) => ({ ...m }))
    },
    post: async (id, text, thread) => {
      enter('post')
      if (id !== channel.id) throw new SlackApiError('channel_not_found')
      return add({ ts: stamp(), thread, user: BOT, botId: 'B0REGENT1', subtype: null, text })
    },
    react: async (_id, ts, name) => { enter('react'); reactions.push({ ts, name }) },
  }
}

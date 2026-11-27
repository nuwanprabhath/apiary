import { describe, expect, it } from 'vitest'
import { SlackApiError, createSlackApi, describeSlackError } from '../../../src/main/slack/slackApi'

type Call = { url: string; init: RequestInit }
function stub(answers: (call: Call) => Response): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = []
  const stubbed = ((url: string, init: RequestInit) => {
    const call = { url, init }
    calls.push(call)
    return Promise.resolve(answers(call))
  }) as unknown as typeof fetch
  return { fetch: stubbed, calls }
}
const bodyOf = (init: RequestInit | undefined): string => (typeof init?.body === 'string' ? init.body : '')
const json =(body: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(body), init)
const api = (f: typeof fetch) => createSlackApi({ fetch: f, baseUrl: 'https://slack.test/api', token: async () => 'xoxb-secret-1' })

describe('slackApi', () => {
  it('sends the token as a bearer header and never in the URL', async () => {
    const { fetch, calls } = stub(() => json({ ok: true, user_id: 'UB1', user: 'regent' }))
    await expect(api(fetch).authTest()).resolves.toEqual({ userId: 'UB1', name: 'regent' })
    expect(calls[0]?.url).toBe('https://slack.test/api/auth.test')
    expect(new Headers(calls[0]?.init.headers).get('Authorization')).toBe('Bearer xoxb-secret-1')
    expect(JSON.stringify(calls)).not.toMatch(/xoxb-secret-1.*xoxb-secret-1/)
    expect(calls[0]?.url).not.toContain('xoxb')
    expect(bodyOf(calls[0]?.init)).not.toContain('xoxb')
  })

  it('pages conversations.list until the channel is found', async () => {
    const { fetch, calls } = stub((c) => {
      const second = bodyOf(c.init).includes('cursor=next')
      return json(second
        ? { ok: true, channels: [{ id: 'C2', name: 'work' }], response_metadata: { next_cursor: '' } }
        : { ok: true, channels: [{ id: 'C1', name: 'mac' }], response_metadata: { next_cursor: 'next' } })
    })
    await expect(api(fetch).findChannel('#work')).resolves.toEqual({ id: 'C2', name: 'work' })
    expect(calls).toHaveLength(2)
    expect(bodyOf(calls[0]?.init)).toContain('exclude_archived=true')
  })

  it('a 429 carries its Retry-After as retryAfterMs', async () => {
    const { fetch } = stub(() => json({ ok: false, error: 'ratelimited' }, { status: 429, headers: { 'Retry-After': '7' } }))
    const error = await api(fetch).history('C1', 100).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SlackApiError)
    expect(error).toMatchObject({ code: 'ratelimited', retryAfterMs: 7000 })
  })

  it('maps not_in_channel and invalid_auth to a sentence a person can act on', async () => {
    const { fetch } = stub((c) => json({ ok: false, error: c.url.endsWith('history') ? 'not_in_channel' : 'invalid_auth' }))
    const a = api(fetch)
    const notIn = await a.history('C1', 1).catch((e: unknown) => e)
    expect(describeSlackError(notIn, { channel: 'work', bot: 'Regent' })).toBe('The bot is not in #work. Invite it with /invite @Regent.')
    const auth = await a.authTest().catch((e: unknown) => e)
    expect(describeSlackError(auth)).toBe('Slack refused the token.')
    expect(describeSlackError(new SlackApiError('missing_scope', null, 'chat:write'))).toContain('chat:write')
    expect(describeSlackError(new SlackApiError('network'))).toBe('Could not reach Slack.')
  })

  it('every other failure still gets a sentence', () => {
    expect(describeSlackError(new Error('boom'))).toBe('Slack did not answer as expected.')
    expect(describeSlackError(new SlackApiError('channel_not_found'), { channel: null })).toBe('The bot is not in the channel. Invite it with /invite @regent.')
    expect(describeSlackError(new SlackApiError('missing_scope'))).toBe('The Slack app is missing a permission (scope).')
    expect(describeSlackError(new SlackApiError('ratelimited'))).toBe('Slack is rate limiting this app; waiting.')
    expect(describeSlackError(new SlackApiError('weird_thing'))).toBe('Slack answered with an error (weird_thing).')
  })

  it('fails with a code for no token, no network, a body that is not JSON and an error with no name', async () => {
    const noToken = createSlackApi({ fetch: stub(() => json({ ok: true })).fetch, baseUrl: 'https://slack.test/api', token: async () => null })
    await expect(noToken.authTest()).rejects.toMatchObject({ code: 'not_authed' })
    const offline = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch
    await expect(api(offline).authTest()).rejects.toMatchObject({ code: 'network' })
    await expect(api(stub(() => new Response('<html>', { status: 502 })).fetch).authTest()).rejects.toMatchObject({ code: 'http_502' })
    await expect(api(stub(() => json([1, 2])).fetch).authTest()).rejects.toMatchObject({ code: 'http_200' })
    await expect(api(stub(() => json({ ok: false })).fetch).authTest()).rejects.toMatchObject({ code: 'unknown', needed: null })
  })

  it('a 429 without Retry-After waits 30 s', async () => {
    const { fetch } = stub(() => json({ ok: false }, { status: 429 }))
    await expect(api(fetch).react('C1', '1.0', 'eyes')).rejects.toMatchObject({ code: 'ratelimited', retryAfterMs: 30_000 })
  })

  it('removes a reaction with reactions.remove; one that is not there, or already there, is no error', async () => {
    const { fetch, calls } = stub((c) => json(c.url.endsWith('reactions.remove') ? { ok: false, error: 'no_reaction' } : { ok: false, error: 'already_reacted' }))
    await expect(api(fetch).unreact('C1', '1.0', 'eyes')).resolves.toBeUndefined()
    expect(calls[0]?.url).toBe('https://slack.test/api/reactions.remove')
    expect(bodyOf(calls[0]?.init)).toBe('channel=C1&timestamp=1.0&name=eyes')
    await expect(api(fetch).react('C1', '1.0', 'eyes')).resolves.toBeUndefined()
    const refused = stub(() => json({ ok: false, error: 'missing_scope', needed: 'reactions:write' }))
    await expect(api(refused.fetch).unreact('C1', '1.0', 'eyes')).rejects.toMatchObject({ code: 'missing_scope' })
  })

  it('reads replies without their parent, from oldest on, and marks which are in a thread', async () => {
    const { fetch, calls } = stub(() => json({ ok: true, messages: [
      { ts: '1.0', thread_ts: '1.0', user: 'U1', text: 'parent', latest_reply: '3.0' },
      { ts: '2.0', thread_ts: '1.0', user: 'U1', text: 'reply' },
      { ts: '3.0', thread_ts: '1.0', bot_id: 'B1', subtype: 'bot_message' },
      'not a message',
    ] }))
    const replies = await api(fetch).replies('C1', '1.0', '1.5')
    expect(bodyOf(calls[0]?.init)).toContain('oldest=1.5')
    expect(replies).toEqual([
      { ts: '2.0', thread: '1.0', user: 'U1', botId: null, subtype: null, text: 'reply', latestReply: null },
      { ts: '3.0', thread: '1.0', user: null, botId: 'B1', subtype: 'bot_message', text: '', latestReply: null },
    ])
    const top = await api(fetch).history('C1', 5)
    expect(top[0]).toMatchObject({ ts: '1.0', thread: null, latestReply: '3.0' })
  })

  it('posts into a thread and fails when Slack gives no ts back', async () => {
    const { fetch, calls } = stub((c) => json(bodyOf(c.init).includes('thread_ts=1.0') ? { ok: true, ts: '9.0' } : { ok: true }))
    await expect(api(fetch).post('C1', 'hi', '1.0')).resolves.toBe('9.0')
    expect(bodyOf(calls[0]?.init)).toContain('thread_ts=1.0')
    await expect(api(fetch).post('C1', 'hi', null)).rejects.toMatchObject({ code: 'no_ts' })
  })

  it('finds no channel when the last page has no match', async () => {
    const { fetch } = stub(() => json({ ok: true, channels: [{ id: 'C1', name: 'mac' }, { id: 7 }] }))
    await expect(api(fetch).findChannel('work')).resolves.toBeNull()
    await expect(api(fetch).findChannel('C1')).resolves.toEqual({ id: 'C1', name: 'mac' })
  })
})

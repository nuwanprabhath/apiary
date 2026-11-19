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
})

import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SlackApi } from '../../../src/main/slack/slackApi'
import { SlackBridge, type SlackHandler, type SlackInbound } from '../../../src/main/slack/slackBridge'
import { SlackStore } from '../../../src/main/slack/slackStore'
import { fakeSlack, type FakeSlack } from '../../fixtures/fakeSlack'
import { memoryCipher } from '../../fixtures/memoryCipher'

const NOTHING = "Nothing on this machine is set up to act on Slack messages. Turn on Regent in Apiary's settings."
const MINUTE = 60_000

interface World {
  slack: FakeSlack
  store: SlackStore
  /** A bridge on the same store and Slack, started; the earlier one (if any) must be stopped first. */
  boot(api?: SlackApi): Promise<{ bridge: SlackBridge; stop: () => Promise<void> }>
  seen: SlackInbound[]
}

let stops: (() => Promise<void>)[] = []

async function world(): Promise<World> {
  const slack = fakeSlack({ now: Date.now })
  const store = new SlackStore(join(mkdtempSync(join(tmpdir(), 'apiary-slackbridge-')), 'slack.json'), memoryCipher())
  const seen: SlackInbound[] = []
  const boot: World['boot'] = async (api = slack) => {
    const bridge = new SlackBridge({ store, api, now: Date.now })
    if (!store.state.enabled) await bridge.configure({ token: 'xoxb-test-token', channel: 'work', ownerId: slack.owner, enabled: true })
    const stop = bridge.start()
    stops.push(stop)
    // The first cycle sets the cursor to now; the millisecond after is when the owner next speaks.
    await vi.advanceTimersByTimeAsync(1)
    return { bridge, stop }
  }
  return { slack, store, boot, seen }
}

const record = (seen: SlackInbound[], consume = true): SlackHandler => (m) => { seen.push(m); return consume }
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

describe('SlackBridge', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-19T10:00:00Z')); stops = [] })
  afterEach(async () => { for (const stop of stops) await stop(); vi.useRealTimers() })

  it('a first run sets the cursor to now and carries out nothing older', async () => {
    const w = await world()
    w.slack.ownerSays('from before Slack was set up')
    await tick(5)
    const { bridge } = await w.boot()
    bridge.handle(10, record(w.seen))
    await tick(30_000)
    expect(w.seen).toEqual([])
    expect(w.store.state.cursor).not.toBeNull()
    expect(w.slack.reactions()).toEqual([])
  })

  it('a top-level message from the owner opens a task, gets eyes, and reaches the handlers in order', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    const order: string[] = []
    bridge.handle(100, (m) => { order.push('c'); w.seen.push(m); return true })
    bridge.handle(20, () => { order.push('b'); return false })
    bridge.handle(10, () => { order.push('a'); return false })
    const ts = w.slack.ownerSays('Hello <@U1> &amp; co')
    await tick(10_000)
    expect(order).toEqual(['a', 'b', 'c'])
    expect(w.seen).toEqual([{ thread: ts, ts, text: 'Hello @U1 & co', kind: 'task' }])
    expect(w.slack.reactions()).toEqual([{ ts, name: 'eyes' }])
    expect(bridge.tasks.get(ts)).toMatchObject({ state: 'open', text: 'Hello @U1 & co' })
  })

  it('the first handler that returns true consumes it', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    const later = vi.fn(() => true)
    bridge.handle(10, record(w.seen))
    bridge.handle(20, later)
    w.slack.ownerSays('status')
    await tick(10_000)
    expect(w.seen).toHaveLength(1)
    expect(later).not.toHaveBeenCalled()
    expect(w.slack.posts()).toEqual([])
  })

  it('a reply in a task thread reaches the handlers as a reply, once', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    bridge.handle(10, record(w.seen))
    const ts = w.slack.ownerSays('start')
    await tick(10_000)
    const reply = w.slack.ownerSays('and also this', { thread: ts })
    await tick(3_000)
    await tick(9_000)
    expect(w.seen.map((m) => [m.kind, m.thread, m.ts, m.text])).toEqual([['task', ts, ts, 'start'], ['reply', ts, reply, 'and also this']])
  })

  it('messages from anyone else, from bots, and edits are ignored', async () => {
    const w = await world()
    const edits: SlackApi = { ...w.slack, history: async (c, l) => (await w.slack.history(c, l)).map((m) => (m.text === 'edited' ? { ...m, subtype: 'message_changed' } : m)) }
    const { bridge } = await w.boot(edits)
    bridge.handle(10, record(w.seen))
    w.slack.otherSays('hello from a colleague')
    w.slack.otherSays('hello from a bot', { bot: true })
    w.slack.ownerSays('edited')
    await tick(10_000)
    expect(w.seen).toEqual([])
    expect(w.slack.reactions()).toEqual([])
    expect(w.slack.posts()).toEqual([])
    const mine = w.slack.ownerSays('real one')
    await tick(10_000)
    expect(w.seen.map((m) => m.thread)).toEqual([mine])
  })

  it('with no handler taking it, it says nothing here can act', async () => {
    const w = await world()
    await w.boot()
    const ts = w.slack.ownerSays('anyone there?')
    await tick(10_000)
    expect(w.slack.posts()).toEqual([{ ts: expect.any(String) as string, thread: ts, text: NOTHING }])
  })

  async function staleWorld(): Promise<{ w: World; ts: string }> {
    const w = await world()
    const first = await w.boot()
    await first.stop()
    const ts = w.slack.ownerSays('old request')
    await tick(20 * MINUTE)
    const second = await w.boot()
    second.bridge.handle(10, record(w.seen))
    return { w, ts }
  }

  it('a message older than 15 minutes is asked about first, and yes carries it out', async () => {
    const { w, ts } = await staleWorld()
    await tick(0)
    expect(w.seen).toEqual([])
    expect(w.slack.posts().map((p) => [p.thread, p.text])).toEqual([[ts, 'I was offline when you sent this. Still want it? Reply yes.']])
    w.slack.ownerSays('Yes!', { thread: ts })
    await tick(10_000)
    expect(w.seen).toEqual([{ thread: ts, ts, text: 'old request', kind: 'task' }])
    expect(w.store.state.awaiting).toEqual([])
  })

  it('no drops an awaited message', async () => {
    const { w, ts } = await staleWorld()
    w.slack.ownerSays('no', { thread: ts })
    await tick(10_000)
    expect(w.seen).toEqual([])
    expect(w.slack.posts().at(-1)?.text).toBe('Dropped.')
    expect(w.store.state.awaiting).toEqual([])
  })

  it('one history call per cycle, and replies only for a thread whose latest_reply moved', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    bridge.handle(10, record(w.seen))
    const first = w.slack.calls().history ?? 0
    await tick(10_000)
    await tick(10_000)
    expect(w.slack.calls().history).toBe(first + 2)
    const ts = w.slack.ownerSays('task')
    await tick(10_000)
    await tick(3_000)
    await tick(3_000)
    expect(w.slack.calls().replies ?? 0).toBe(0)
    w.slack.ownerSays('more', { thread: ts })
    await tick(3_000)
    await tick(3_000)
    await tick(3_000)
    expect(w.slack.calls().replies).toBe(1)
  })

  it('polls every 3 s with a task open and every 10 s without', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    bridge.handle(10, record(w.seen))
    const base = (): number => w.slack.calls().history ?? 0
    const before = base()
    await tick(9_998)
    expect(base()).toBe(before)
    await tick(1)
    expect(base()).toBe(before + 1)
    w.slack.ownerSays('open a task')
    await tick(10_000)
    const open = base()
    await tick(2_999)
    expect(base()).toBe(open)
    await tick(1)
    expect(base()).toBe(open + 1)
    await tick(3_000)
    expect(base()).toBe(open + 2)
  })

  it('a rate limit waits its Retry-After, another failure 60 s, then polling resumes', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    const calls = (): number => w.slack.calls().history ?? 0
    w.slack.failNext('history', 'ratelimited', 20_000)
    await tick(10_000)
    const limited = calls()
    expect(bridge.status().connection).toBe('error')
    await tick(19_998)
    expect(calls()).toBe(limited)
    await tick(1)
    expect(calls()).toBe(limited + 1)
    expect(bridge.status().connection).toBe('connected')
    w.slack.failNext('history', 'internal_error')
    await tick(10_000)
    const failed = calls()
    await tick(59_999)
    expect(calls()).toBe(failed)
    await tick(1)
    expect(calls()).toBe(failed + 1)
    expect(bridge.status()).toMatchObject({ connection: 'connected', error: null })
  })

  it('a handler that throws is not a consumer and the next message is still delivered', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    bridge.handle(10, (m) => { if (m.text === 'one') throw new Error('boom'); w.seen.push(m); return true })
    const first = w.slack.ownerSays('one')
    w.slack.ownerSays('two')
    await tick(10_000)
    expect(w.seen.map((m) => m.text)).toEqual(['two'])
    expect(w.slack.posts().map((p) => [p.thread, p.text])).toEqual([[first, NOTHING]])
  })

  it('a restart does not hand over a message twice', async () => {
    const w = await world()
    const first = await w.boot()
    first.bridge.handle(10, record(w.seen))
    const ts = w.slack.ownerSays('once')
    await tick(10_000)
    expect(w.seen).toHaveLength(1)
    await first.stop()
    const second = await w.boot()
    second.bridge.handle(10, record(w.seen))
    await tick(30_000)
    expect(w.seen).toHaveLength(1)
    expect(second.bridge.tasks.get(ts)?.state).toBe('open')
  })

  it('turning it off stops polling and keeps the token', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    const status = await bridge.configure({ enabled: false })
    expect(status).toMatchObject({ enabled: false, connection: 'off', hasToken: true })
    await tick(1_000)
    const before = w.slack.calls().history ?? 0
    await tick(2 * MINUTE)
    expect(w.slack.calls().history ?? 0).toBe(before)
    expect(await w.store.token()).toBe('xoxb-test-token')
  })

  it('react adds a reaction and a failure is ignored', async () => {
    const w = await world()
    const { bridge } = await w.boot()
    await bridge.react('1.000001', 'white_check_mark')
    expect(w.slack.reactions()).toEqual([{ ts: '1.000001', name: 'white_check_mark' }])
    w.slack.failNext('react', 'already_reacted')
    await expect(bridge.react('1.000002', 'white_check_mark')).resolves.toBeUndefined()
  })
})

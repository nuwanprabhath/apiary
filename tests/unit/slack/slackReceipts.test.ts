import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SlackBridge, type SlackInbound } from '../../../src/main/slack/slackBridge'
import { SlackStore } from '../../../src/main/slack/slackStore'
import { fakeSlack } from '../../fixtures/fakeSlack'
import { memoryCipher } from '../../fixtures/memoryCipher'

let stops: (() => Promise<void>)[] = []
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms) }

/** A started bridge whose one handler answers each message in its thread with `answer` (none: it only records). */
async function world(answer: ((m: SlackInbound) => string) | null = null) {
  const slack = fakeSlack({ now: Date.now })
  const store = new SlackStore(join(mkdtempSync(join(tmpdir(), 'apiary-slackreceipts-')), 'slack.json'), memoryCipher())
  const bridge = new SlackBridge({ store, api: slack, now: Date.now })
  await bridge.configure({ token: 'xoxb-test-token', channel: 'work', ownerId: slack.owner, enabled: true })
  const seen: SlackInbound[] = []
  bridge.handle(10, async (m) => { seen.push(m); if (answer !== null) await bridge.post(m.thread, answer(m)); return true })
  stops.push(bridge.start())
  await tick(1)
  return { slack, bridge, seen }
}

describe('Slack receipts: eyes when taken, a tick when answered', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-27T10:00:00Z')); stops = [] })
  afterEach(async () => { for (const stop of stops) await stop(); vi.useRealTimers() })

  it('a top-level message gets eyes, then a tick in place of them once its answer is posted', async () => {
    const w = await world()
    const ts = w.slack.ownerSays('fix the login spec')
    await tick(10_000)
    expect(w.slack.reactions()).toEqual([{ ts, name: 'eyes' }])
    await w.bridge.post(ts, 'Started a session for it.')
    expect(w.slack.reactionLog()).toEqual([`+eyes ${ts}`, `-eyes ${ts}`, `+white_check_mark ${ts}`])
    expect(w.slack.reactions()).toEqual([{ ts, name: 'white_check_mark' }])
  })

  it('a reply in the thread gets its own eyes and then its own tick, and the parent is not touched again', async () => {
    const w = await world((m) => `answer to ${m.text}`)
    const ts = w.slack.ownerSays('start')
    await tick(10_000)
    const reply = w.slack.ownerSays('and also this', { thread: ts })
    await tick(12_000)
    expect(w.seen.map((m) => m.ts)).toEqual([ts, reply])
    expect(w.slack.reactionLog()).toEqual([
      `+eyes ${ts}`, `-eyes ${ts}`, `+white_check_mark ${ts}`,
      `+eyes ${reply}`, `-eyes ${reply}`, `+white_check_mark ${reply}`,
    ])
  })

  it('a post that is not an answer leaves the eyes; finishing the task ticks them', async () => {
    const w = await world()
    const ts = w.slack.ownerSays('deploy it')
    await tick(10_000)
    await w.bridge.post(ts, '*Fix login* wants to run: npm test.', { answers: false })
    expect(w.slack.reactions()).toEqual([{ ts, name: 'eyes' }])
    await w.bridge.finish(ts)
    expect(w.slack.reactions()).toEqual([{ ts, name: 'white_check_mark' }])
    expect(w.bridge.tasks.get(ts)?.state).toBe('done')
  })

  it('failing reaction calls never stop the message or its answer', async () => {
    const w = await world(() => 'done')
    w.slack.failNext('react', 'ratelimited')
    w.slack.failNext('unreact', 'missing_scope')
    w.slack.failNext('react', 'internal_error')
    const ts = w.slack.ownerSays('go')
    await tick(10_000)
    expect(w.seen.map((m) => m.ts)).toEqual([ts])
    expect(w.slack.posts().map((p) => [p.thread, p.text])).toEqual([[ts, 'done']])
    expect(w.bridge.tasks.get(ts)?.receipts).toEqual([])
  })

  it('posts link bare references to the repository the desk names for the thread', async () => {
    const w = await world()
    const ts = w.slack.ownerSays('which issues?')
    await tick(10_000)
    const asked: (string | null)[] = []
    w.bridge.linkReferences(async (thread) => { asked.push(thread); return { forge: 'gitlab', webUrl: 'https://gitlab.test/g/p' } })
    await w.bridge.post(ts, '#3277 is written that way, see `#1`')
    expect(asked).toEqual([ts])
    expect(w.slack.posts().at(-1)?.text).toBe('<https://gitlab.test/g/p/-/issues/3277|#3277> is written that way, see `#1`')
  })
})

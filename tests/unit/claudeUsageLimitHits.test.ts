import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MAIN_ACCOUNT_ID, type AccountsState } from '@shared/domain/accounts'
import { asAccountId, asSessionId } from '@shared/domain/ids'
import { ConsentStore, memoryConsentStorage } from '../../src/main/statusBar/claudeUsage/consent'
import { parseLimitHit, withLimitHits } from '../../src/main/statusBar/claudeUsage/limitHits'
import { retryAfterMs } from '../../src/main/statusBar/claudeUsage/limits'
import { createClaudeUsagePlugin } from '../../src/main/statusBar/claudeUsage/plugin'
import { UsageFeed } from '../../src/main/statusBar/claudeUsage/usageFeed'

/** A limit record as Claude Code writes it (shape copied from a real transcript). */
const hitLine = (timestamp: string, text: string, sessionId = 's1'): Record<string, unknown> => ({
  type: 'assistant', timestamp, sessionId, isApiErrorMessage: true, error: 'rate_limit', apiErrorStatus: 429,
  message: { model: '<synthetic>', role: 'assistant', content: [{ type: 'text', text }], usage: { input_tokens: 0, output_tokens: 0 } },
})
const local = (y: number, mo: number, d: number, h: number, mi = 0): number => new Date(y, mo - 1, d, h, mi).getTime()
const iso = (ms: number): string => new Date(ms).toISOString()

describe('reading a limit hit from a transcript line', () => {
  it('reads the 5-hour, session and weekly wordings and their reset times', () => {
    const at = local(2026, 11, 25, 12, 43)
    const five = parseLimitHit(hitLine(iso(at), "You've hit your 5-hour limit · resets 2:20pm (Australia/Adelaide)"), 'file')
    expect(five).toEqual({ window: 'fiveHour', atMs: at, resetsAtMs: local(2026, 11, 25, 14, 20), sessionId: 's1' })
    expect(parseLimitHit(hitLine(iso(at), "You've hit your session limit · resets 5pm (Australia/Adelaide)"), 'f')?.resetsAtMs).toBe(local(2026, 11, 25, 17))
    const weekly = parseLimitHit(hitLine(iso(local(2026, 11, 13, 21)), "You've hit your weekly limit · resets Nov 19, 2:30am (Australia/Adelaide)"), 'f')
    expect(weekly).toMatchObject({ window: 'sevenDay', resetsAtMs: local(2026, 11, 19, 2, 30) })
  })

  it('a reset earlier in the day is the next day\'s, and one it cannot read is the window\'s longest', () => {
    const at = local(2026, 11, 16, 23)
    expect(parseLimitHit(hitLine(iso(at), "You've hit your 5-hour limit · resets 1:30am"), 'f')?.resetsAtMs).toBe(local(2026, 11, 17, 1, 30))
    expect(parseLimitHit(hitLine(iso(at), "You've hit your 5-hour limit · resets soon"), 'f')?.resetsAtMs).toBe(at + 5 * 3_600_000)
  })

  it('ignores everything that is not Claude Code\'s own limit record', () => {
    const at = iso(local(2026, 11, 25, 12))
    expect(parseLimitHit({ ...hitLine(at, "You've hit your 5-hour limit · resets 2pm"), isApiErrorMessage: undefined }, 'f')).toBeNull()
    expect(parseLimitHit({ ...hitLine(at, 'API Error: overloaded'), error: 'rate_limit' }, 'f')).toBeNull()
    expect(parseLimitHit({ type: 'user', timestamp: at, message: { content: "You've hit your 5-hour limit · resets 2pm" } }, 'f')).toBeNull()
  })
})

describe('the shown limits', () => {
  const fetchedAt = local(2026, 11, 25, 11, 20)
  const fetched = { fiveHour: { utilization: 80, resetsAt: iso(local(2026, 11, 25, 14, 20)) }, sevenDay: { utilization: 31 }, fetchedAt }
  const hit = { window: 'fiveHour' as const, atMs: local(2026, 11, 25, 12, 43), resetsAtMs: local(2026, 11, 25, 14, 20), sessionId: asSessionId('s1') }

  it('a hit after the fetch reads 100% until its reset; the other window is untouched', () => {
    const shown = withLimitHits(fetched, [hit], local(2026, 11, 25, 13))
    expect(shown.fromTranscript).toBe(true)
    expect(shown.limits?.fiveHour).toEqual({ utilization: 100, resetsAt: iso(hit.resetsAtMs) })
    expect(shown.limits?.sevenDay).toEqual({ utilization: 31 })
  })

  it('a hit before the fetch, or past its reset, changes nothing', () => {
    expect(withLimitHits(fetched, [{ ...hit, atMs: fetchedAt - 1 }], local(2026, 11, 25, 13))).toEqual({ limits: fetched, fromTranscript: false })
    expect(withLimitHits(fetched, [hit], local(2026, 11, 25, 14, 21))).toEqual({ limits: fetched, fromTranscript: false })
  })
})

describe('Retry-After', () => {
  it('reads seconds and dates', () => {
    expect(retryAfterMs('120', 0)).toBe(120_000)
    expect(retryAfterMs(new Date(90_000).toUTCString(), 30_000)).toBe(60_000)
    expect(retryAfterMs(null, 0)).toBeUndefined()
    expect(retryAfterMs('soon', 0)).toBeUndefined()
  })
})

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/**
 * The work machine on 25 November: the endpoint answered 80% at 11:20, then turned every poll and
 * every refresh away with HTTP 429, and the bar said 80% while Claude Code had hit the limit at 12:43.
 */
function stuckAt80(o: { sessions?: Record<string, string> } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'apiary-usage-hits-'))
  dirs.push(root)
  const project = join(root, 'projects', '-home-me-repo')
  mkdirSync(project, { recursive: true })
  writeFileSync(join(project, 's1.jsonl'), `${JSON.stringify({ type: 'user', timestamp: iso(local(2026, 11, 25, 11)), sessionId: 's1', message: { content: 'hi' } })}\n`)
  writeFileSync(join(root, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: 'tok' } }))
  let clock = local(2026, 11, 25, 11, 20)
  let answer: Response | (() => Response) = () => new Response(JSON.stringify({ five_hour: { utilization: 80, resets_at: iso(local(2026, 11, 25, 14, 20)) }, seven_day: { utilization: 31 } }))
  const fetchImpl = (async () => (typeof answer === 'function' ? answer() : answer)) as unknown as typeof fetch
  const feed = new UsageFeed()
  const state: AccountsState = { accounts: [{ id: MAIN_ACCOUNT_ID, label: 'Main', email: 'me@x', isMain: true }, { id: asAccountId('work'), label: 'Work', email: 'w@x', isMain: false }], defaultId: MAIN_ACCOUNT_ID }
  const plugin = createClaudeUsagePlugin({
    configRoot: root, useKeychain: false, fetchImpl, feed, now: () => new Date(clock),
    consent: new ConsentStore(memoryConsentStorage('granted')),
    accounts: o.sessions === undefined ? null : {
      list: () => state, configRootFor: () => root, onChanged: () => () => {},
      accountOf: (id) => asAccountId(o.sessions?.[id] ?? MAIN_ACCOUNT_ID),
    },
    setTimeout: () => ({}), clearTimeout: () => {},
  })
  plugin.start({ settings: () => ({}), changed: () => {} })
  const hitLimit = (at: number): void => {
    appendFileSync(join(project, 's1.jsonl'), `${JSON.stringify(hitLine(iso(at), "You've hit your 5-hour limit · resets 2:20pm (Australia/Adelaide)"))}\n`)
  }
  return {
    plugin, feed, hitLimit,
    turnAway: () => { answer = () => new Response('', { status: 429, headers: { 'retry-after': '600' } }) },
    at: (ms: number) => { clock = ms },
  }
}

describe('the usage plugin while the endpoint turns it away', () => {
  it('Refresh shows 100% once Claude Code has hit the limit, and the hover says why', async () => {
    const h = stuckAt80()
    await h.plugin.refresh()
    expect(h.plugin.items()[0]?.text).toMatch(/^5h 80% .* · 7d 31%$/)

    h.turnAway()
    h.at(local(2026, 11, 25, 12, 43))
    h.hitLimit(local(2026, 11, 25, 12, 43))
    h.at(local(2026, 11, 25, 13, 59))
    await h.plugin.refresh()

    const item = h.plugin.items()[0]
    expect(item?.text).toMatch(/^5h 100% .* · 7d 31%$/)
    expect(item).toMatchObject({ tone: 'danger', stale: true })
    const notes = item?.detail.flatMap((s) => (s.kind === 'note' ? [s.text] : [])) ?? []
    expect(notes.join('\n')).toContain('turning Apiary away for now (HTTP 429)')
    expect(notes.join('\n')).toContain('Claude Code reported hitting the limit')
    expect(h.feed.limitResetsAt(MAIN_ACCOUNT_ID)).toBe(local(2026, 11, 25, 14, 20))
    h.plugin.stop()
  })

  it('a hit in a session of another account leaves this account\'s meter alone', async () => {
    const h = stuckAt80({ sessions: { s1: 'work' } })
    await h.plugin.refresh()
    h.turnAway()
    h.hitLimit(local(2026, 11, 25, 12, 43))
    h.at(local(2026, 11, 25, 13, 59))
    await h.plugin.refresh()
    const [mainItem, workItem] = h.plugin.items()
    expect(mainItem?.text).toMatch(/^Main · 5h 80%/)
    expect(workItem?.text).toMatch(/^Work · 5h 100%/)
    h.plugin.stop()
  })
})

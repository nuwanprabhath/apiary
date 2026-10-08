import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseLimits, fetchLimits, HttpError } from '../../src/main/statusBar/claudeUsage/limits'
import { ConsentStore, memoryConsentStorage } from '../../src/main/statusBar/claudeUsage/consent'
import { extractToken, readAccessToken } from '../../src/main/statusBar/claudeUsage/credentials'
import { costForTokens } from '../../src/main/statusBar/claudeUsage/pricing'
import { TokenAggregator } from '../../src/main/statusBar/claudeUsage/tokens'
import { statusText, statusTone, fmtTokens, fmtUsd, detailSections, dashboard, relativeTime } from '../../src/main/statusBar/claudeUsage/present'
import { createClaudeUsagePlugin } from '../../src/main/statusBar/claudeUsage/plugin'

/** What the user's "Allow" produces; the credential functions will not run without it. */
const granted = (): NonNullable<ReturnType<ConsentStore['proof']>> => {
  const proof = new ConsentStore(memoryConsentStorage('granted')).proof()
  if (proof === undefined) throw new Error('a granted store gives a proof')
  return proof
}

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'apiary-usage-'))
  dirs.push(d)
  return d
}

describe('the usage endpoint answer', () => {
  it('is read defensively: missing or malformed windows are simply absent, values are clamped', () => {
    const l = parseLimits({ five_hour: { utilization: 130, resets_at: '2026-10-01T04:50:00Z' }, seven_day: { utilization: 'x' } }, 1)
    expect(l.fiveHour).toEqual({ utilization: 100, resetsAt: '2026-10-01T04:50:00Z' })
    expect(l.sevenDay).toBeUndefined()
    expect(parseLimits(null, 1)).toEqual({ fiveHour: undefined, sevenDay: undefined, sevenDayOpus: undefined, fetchedAt: 1 })
  })

  it('sends the token only as a bearer header to the usage endpoint, and a non-2xx is an HttpError', async () => {
    const seen: { url: string; auth: string }[] = []
    const ok = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: (init.headers as Record<string, string>).Authorization })
      return new Response(JSON.stringify({ five_hour: { utilization: 10 } }), { status: 200 })
    }) as unknown as typeof fetch
    await fetchLimits(granted(), 'tok', ok)
    expect(seen).toEqual([{ url: 'https://api.anthropic.com/api/oauth/usage', auth: 'Bearer tok' }])
    const denied = (async () => new Response('', { status: 429 })) as unknown as typeof fetch
    await expect(fetchLimits(granted(), 'tok', denied)).rejects.toBeInstanceOf(HttpError)
  })
})

describe('credentials', () => {
  it('reads claudeAiOauth.accessToken, and nothing else counts', () => {
    expect(extractToken('{"claudeAiOauth":{"accessToken":"abc"}}')).toBe('abc')
    expect(extractToken('{"claudeAiOauth":{}}')).toBeUndefined()
    expect(extractToken('not json')).toBeUndefined()
  })

  it('falls back to <config>/.credentials.json, and never asks the Keychain when told not to', async () => {
    const root = tmp()
    writeFileSync(join(root, '.credentials.json'), '{"claudeAiOauth":{"accessToken":"from-file"}}')
    let asked = false
    const readKeychain = async (): Promise<string | undefined> => { asked = true; return '{"claudeAiOauth":{"accessToken":"kc"}}' }
    expect(await readAccessToken(granted(), { configRoot: root, useKeychain: false, readKeychain })).toBe('from-file')
    expect(asked).toBe(false)
    expect(await readAccessToken(granted(), { configRoot: root, useKeychain: true, readKeychain })).toBe('kc')
  })
})

describe('the status text', () => {
  it('reads like the VS Code extension: 5h with its reset time, then 7d', () => {
    const text = statusText({ fiveHour: { utilization: 10.4, resetsAt: '2026-10-01T04:50:00Z' }, sevenDay: { utilization: 2 }, fetchedAt: 0 })
    expect(text).toMatch(/^5h 10% \(\d{1,2}:\d{2} [ap]m\) · 7d 2%$/)
  })

  it('turns warning, then danger, at the configured levels — on whichever window is worse', () => {
    const t = { warn: 80, danger: 95 }
    expect(statusTone({ fiveHour: { utilization: 10 }, sevenDay: { utilization: 79 }, fetchedAt: 0 }, t)).toBe('normal')
    expect(statusTone({ fiveHour: { utilization: 10 }, sevenDay: { utilization: 80 }, fetchedAt: 0 }, t)).toBe('warning')
    expect(statusTone({ fiveHour: { utilization: 96 }, fetchedAt: 0 }, t)).toBe('danger')
  })

  it('formats tokens and dollars compactly', () => {
    expect([fmtTokens(999), fmtTokens(1500), fmtTokens(2_500_000), fmtTokens(3e9)]).toEqual(['999', '1.5k', '2.5M', '3.00B'])
    expect([fmtUsd(0.1234), fmtUsd(12.345), fmtUsd(123.4)]).toEqual(['$0.123', '$12.35', '$123'])
    expect(relativeTime(0, 90 * 60_000)).toBe('2 hours ago')
  })
})

describe('pricing', () => {
  it('prices cache reads at 0.1× and writes at 1.25× input, and knows a dated model id', () => {
    const t = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheCreate: 1_000_000 }
    expect(costForTokens('claude-haiku-4-5-20251001', t)).toBeCloseTo(1 + 5 + 0.1 + 1.25)
    expect(costForTokens('some-future-model', t)).toBeUndefined()
  })
})

/** A transcript line carrying usage, as Claude Code writes them. */
function usageLine(o: { id: string; req?: string; ts: string; model?: string; input?: number; output?: number }): string {
  return JSON.stringify({
    timestamp: o.ts, requestId: o.req ?? 'r',
    message: { id: o.id, model: o.model ?? 'claude-haiku-4-5', usage: { input_tokens: o.input ?? 100, output_tokens: o.output ?? 10 } },
  })
}

describe('token aggregation over the transcripts', () => {
  it('counts each message once even when a resumed session copied it, by day and by model', async () => {
    const root = tmp()
    const projects = join(root, 'projects')
    mkdirSync(join(projects, '-a'), { recursive: true })
    mkdirSync(join(projects, '-b'), { recursive: true })
    const today = '2026-10-01T10:00:00'
    writeFileSync(join(projects, '-a', 's1.jsonl'), [
      usageLine({ id: 'm1', ts: new Date(today).toISOString() }),
      '{"type":"user","message":{"content":"hi"}}',
      usageLine({ id: 'm2', ts: new Date('2026-09-29T10:00:00').toISOString(), input: 1000 }),
    ].join('\n'))
    // A resume copies m1 into its own file: counted once.
    writeFileSync(join(projects, '-b', 's2.jsonl'), usageLine({ id: 'm1', ts: new Date(today).toISOString() }))

    const stats = await new TokenAggregator(projects, () => new Date('2026-10-01T12:00:00')).compute()
    expect(stats.days).toHaveLength(7)
    expect(stats.days[6].input).toBe(100)
    expect(stats.days[4].input).toBe(1000)
    expect(stats.totals.input).toBe(1100)
    expect(stats.byModel['claude-haiku-4-5'].requests).toBe(2)
    expect(stats.hasUnpricedModel).toBe(false)

    const hover = detailSections({ limits: undefined, stats, stale: false, error: undefined, now: stats.computedAt })
    expect(hover.find((s) => s.kind === 'table')).toBeDefined()
    const panel = dashboard({ limits: undefined, stats, error: undefined, thresholds: { warn: 80, danger: 95 } })
    expect(panel.sections.map((s) => s.kind)).toEqual(expect.arrayContaining(['stacked-bars', 'table', 'line']))
  })
})

describe('the Claude usage plugin', () => {
  interface Timer { fn: () => void; ms: number }
  function harness(opts: { credentials?: string; fetch: typeof fetch }) {
    const root = tmp()
    if (opts.credentials !== undefined) writeFileSync(join(root, '.credentials.json'), opts.credentials)
    const timers: Timer[] = []
    let changes = 0
    const plugin = createClaudeUsagePlugin({
      configRoot: root, useKeychain: false, fetchImpl: opts.fetch,
      consent: new ConsentStore(memoryConsentStorage('granted')),
      setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t },
      clearTimeout: (h) => { const i = timers.indexOf(h as Timer); if (i >= 0) timers.splice(i, 1) },
    })
    const settings: Record<string, number> = {}
    plugin.start({ settings: () => settings, changed: () => { changes++ } })
    return { plugin, timers, settings, changes: () => changes }
  }

  it('without Claude Code credentials, says to sign in and touches no network', async () => {
    let fetched = false
    const h = harness({ fetch: async () => { fetched = true; return new Response('{}') } })
    await h.plugin.refresh()
    expect(fetched).toBe(false)
    expect(h.plugin.items()[0]).toMatchObject({ text: 'Claude: sign in', icon: 'alert' })
    h.plugin.stop()
  })

  it('shows the limits, keeps them marked stale when a later fetch fails, and backs off', async () => {
    let fail = false
    const fetchImpl = (async () => (fail
      ? new Response('', { status: 500 })
      : new Response(JSON.stringify({ five_hour: { utilization: 42 }, seven_day: { utilization: 3 } }), { status: 200 }))) as unknown as typeof fetch
    const h = harness({ credentials: '{"claudeAiOauth":{"accessToken":"t"}}', fetch: fetchImpl })
    await h.plugin.refresh()
    expect(h.plugin.items()[0]).toMatchObject({ text: '5h 42% · 7d 3%', tone: 'normal', action: { kind: 'panel' } })
    expect(h.timers.at(-1)?.ms).toBe(5 * 60_000)

    fail = true
    await h.plugin.refresh()
    expect(h.plugin.items()[0]).toMatchObject({ text: '5h 42% · 7d 3%', stale: true })
    expect(h.changes()).toBeGreaterThan(0)
    h.plugin.stop()
    expect(h.timers).toHaveLength(0)
  })

  it('polls faster once the 5-hour window reaches the high-usage level', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ five_hour: { utilization: 91 } }), { status: 200 })) as unknown as typeof fetch
    const h = harness({ credentials: '{"claudeAiOauth":{"accessToken":"t"}}', fetch: fetchImpl })
    await h.plugin.refresh()
    expect(h.timers.at(-1)?.ms).toBe(30_000)
    expect(h.plugin.items()[0].tone).toBe('warning')
    h.plugin.stop()
  })
})

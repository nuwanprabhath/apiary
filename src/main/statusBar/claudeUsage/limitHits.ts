import { asSessionId, type SessionId } from '@shared/domain/ids'
import type { Limits, WindowLimit } from './limits'

/** A window Claude Code itself said was used up: "You've hit your 5-hour limit · resets 2:20pm". */
export interface LimitHit {
  window: 'fiveHour' | 'sevenDay'
  atMs: number
  resetsAtMs: number
  sessionId: SessionId
}

const HOUR_MS = 3_600_000
const WINDOW_MS: Record<LimitHit['window'], number> = { fiveHour: 5 * HOUR_MS, sevenDay: 7 * 24 * HOUR_MS }
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const HIT = /hit your (5-hour|session|weekly|[\w-]+ weekly) limit\s*·\s*resets\s+(.+?)(?:\s+\([^)]*\))?\s*$/i

/**
 * The limit hit a transcript line records, or null. Claude Code writes one as a synthetic assistant
 * message (`isApiErrorMessage`, `error: "rate_limit"`) when a request is refused for the plan's
 * limit. The reset is read in this machine's time zone, which is the one Claude Code printed it in
 * when both run here; a time that cannot be read, or lands outside the window, falls back to the
 * longest the window can last.
 */
export function parseLimitHit(obj: Record<string, unknown>, fallbackSessionId: string): LimitHit | null {
  if (obj.isApiErrorMessage !== true || obj.error !== 'rate_limit' || typeof obj.timestamp !== 'string') return null
  const atMs = Date.parse(obj.timestamp)
  if (!Number.isFinite(atMs)) return null
  const match = HIT.exec(messageText(obj.message))
  if (match === null) return null
  const window = /weekly/i.test(match[1] ?? '') ? 'sevenDay' : 'fiveHour'
  const longest = atMs + WINDOW_MS[window]
  const read = resetFrom(match[2] ?? '', atMs)
  const resetsAtMs = read !== null && read > atMs && read <= longest ? read : longest
  const sessionId = typeof obj.sessionId === 'string' ? obj.sessionId : fallbackSessionId
  return { window, atMs, resetsAtMs, sessionId: asSessionId(sessionId) }
}

function messageText(message: unknown): string {
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as Record<string, unknown>).content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((c: unknown) => (typeof c === 'object' && c !== null && typeof (c as Record<string, unknown>).text === 'string' ? (c as { text: string }).text : '')).join('')
}

/** "2:20pm", "5pm" or "Nov 19, 2:30am", as the first such moment after `afterMs`, local time. */
function resetFrom(text: string, afterMs: number): number | null {
  const m = /^(?:([a-z]{3})[a-z]*\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i.exec(text.trim())
  if (m === null) return null
  let hour = Number(m[3]) % 12
  if ((m[5] ?? '').toLowerCase() === 'pm') hour += 12
  const minute = Number(m[4] ?? '0')
  const d = new Date(afterMs)
  if (m[1] !== undefined) {
    const month = MONTH_NAMES.indexOf(m[1].toLowerCase())
    if (month < 0) return null
    d.setMonth(month, Number(m[2]))
    d.setHours(hour, minute, 0, 0)
    if (d.getTime() <= afterMs) d.setFullYear(d.getFullYear() + 1)
    return d.getTime()
  }
  d.setHours(hour, minute, 0, 0)
  if (d.getTime() <= afterMs) d.setDate(d.getDate() + 1)
  return d.getTime()
}

/**
 * `limits` with each window Claude Code said is used up since they were fetched set to 100% and its
 * reset, while that reset is still ahead. The usage endpoint refuses Apiary for long stretches (HTTP
 * 429) exactly when a limit is near, so the last fetched answer would otherwise stay on the bar
 * after the limit was hit. `fromTranscript` is true when a window was overridden.
 */
export function withLimitHits(limits: Limits | undefined, hits: readonly LimitHit[], nowMs: number): { limits: Limits | undefined; fromTranscript: boolean } {
  const since = limits?.fetchedAt ?? 0
  const live = hits.filter((h) => h.atMs > since && h.resetsAtMs > nowMs)
  if (live.length === 0) return { limits, fromTranscript: false }
  const out: Limits = { ...(limits ?? { fetchedAt: since }) }
  for (const window of ['fiveHour', 'sevenDay'] as const) {
    const latest = live.filter((h) => h.window === window).sort((a, b) => b.atMs - a.atMs)[0]
    if (latest === undefined) continue
    const hit: WindowLimit = { utilization: 100, resetsAt: new Date(latest.resetsAtMs).toISOString() }
    out[window] = hit
  }
  return { limits: out, fromTranscript: true }
}

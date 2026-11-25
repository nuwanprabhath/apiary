import type { Consent } from './consent'

/** One rate-limit window as the usage endpoint reports it. */
export interface WindowLimit {
  /** 0–100 */
  utilization: number
  /** ISO timestamp when the window resets, if reported. */
  resetsAt?: string
}

export interface Limits {
  fiveHour?: WindowLimit
  sevenDay?: WindowLimit
  sevenDayOpus?: WindowLimit
  fetchedAt: number
}

export class HttpError extends Error {
  /** How long the endpoint asked to be left alone (its `Retry-After`), when it said. */
  constructor(readonly status: number, readonly retryAfterMs?: number) {
    super(`Usage endpoint returned HTTP ${String(status)}`)
  }
}

/** `Retry-After` as seconds or an HTTP date, in milliseconds from `nowMs`; undefined when absent or unreadable. */
export function retryAfterMs(header: string | null, nowMs: number): number | undefined {
  if (header === null || header.trim() === '') return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds >= 0 ? seconds * 1000 : undefined
  const at = Date.parse(header)
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : undefined
}

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

/**
 * Account-wide rate-limit utilization, from the endpoint Claude Code's own /usage reads. It is
 * unofficial, so the answer is parsed defensively and callers degrade to "last known, stale".
 * The token goes to this URL and nowhere else, and only after the user agreed (`Consent`).
 */
export async function fetchLimits(_consent: Consent, token: string, fetchImpl: typeof fetch = fetch, now: () => number = Date.now): Promise<Limits> {
  const res = await fetchImpl(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${token}`,
      'anthropic-beta': 'oauth-2025-04-20',
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) throw new HttpError(res.status, retryAfterMs(res.headers.get('retry-after'), now()))
  return parseLimits(await res.json(), now())
}

export function parseLimits(data: unknown, fetchedAt: number): Limits {
  const d = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  return {
    fiveHour: parseWindow(d.five_hour),
    sevenDay: parseWindow(d.seven_day),
    sevenDayOpus: parseWindow(d.seven_day_opus),
    fetchedAt,
  }
}

function parseWindow(w: unknown): WindowLimit | undefined {
  if (typeof w !== 'object' || w === null) return undefined
  const r = w as Record<string, unknown>
  const utilization = Number(r.utilization)
  if (!Number.isFinite(utilization)) return undefined
  const resetsAt = typeof r.resets_at === 'string' ? r.resets_at : undefined
  return { utilization: Math.max(0, Math.min(100, utilization)), ...(resetsAt !== undefined ? { resetsAt } : {}) }
}

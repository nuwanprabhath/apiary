import { isRecord } from './guards'
import type { DigestLookback } from './domain/residents'

/** Each unit in milliseconds. A month is 30 days: a window, not a calendar. */
const UNIT_MS: Record<DigestLookback['unit'], number> = { days: 86_400_000, weeks: 7 * 86_400_000, months: 30 * 86_400_000 }
const LOOKBACK_AMOUNT_MAX = 999

export function isDigestLookback(v: unknown): v is DigestLookback {
  return isRecord(v) && typeof v.amount === 'number' && Number.isInteger(v.amount)
    && v.amount >= 1 && v.amount <= LOOKBACK_AMOUNT_MAX && Object.hasOwn(UNIT_MS, String(v.unit))
}

/** The earliest last activity (epoch ms) a session needs to be digested, or null for the whole history. */
export function lookbackStart(lookback: DigestLookback | null, nowMs: number): number | null {
  return lookback === null ? null : nowMs - lookback.amount * UNIT_MS[lookback.unit]
}

/** "2 weeks", or "all history". */
export function lookbackText(lookback: DigestLookback | null): string {
  if (lookback === null) return 'all history'
  const unit = lookback.amount === 1 ? lookback.unit.slice(0, -1) : lookback.unit
  return `${String(lookback.amount)} ${unit}`
}

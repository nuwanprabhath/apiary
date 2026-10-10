/**
 * Format a duration in milliseconds as a human-readable string: `45s`, `3m 12s`, `2h 5m 3s`.
 * For durations in hours, omits trailing zero values (e.g., `1h` not `1h 0m 0s`).
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const parts: string[] = []
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  if (s > 0 || parts.length === 0) parts.push(`${s}s`)
  return parts.join(' ')
}

const TIME: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' }

/**
 * When a message was sent, short: the time today ("10:29 AM"), the day and time earlier this year
 * ("Oct 9, 10:29 AM"), with the year for an earlier one. `locale` is the user's by default; the
 * locale decides 12 or 24 hours.
 */
export function formatMessageTime(ms: number, now: number = Date.now(), locale?: string): string {
  const at = new Date(ms)
  const today = new Date(now)
  if (at.toDateString() === today.toDateString()) return at.toLocaleTimeString(locale, TIME)
  const sameYear = at.getFullYear() === today.getFullYear()
  return at.toLocaleString(locale, { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }), ...TIME })
}

/** The full date and time, for a tooltip. */
export function formatMessageDateTime(ms: number, locale?: string): string {
  return new Date(ms).toLocaleString(locale, { dateStyle: 'full', timeStyle: 'medium' })
}

/**
 * Keeps a time only on the first of a run of messages sent in the same minute, so a quick
 * exchange does not repeat it. A message with no time neither shows one nor breaks the run.
 */
export function firstOfMinuteRun(stamps: readonly (number | null)[]): (number | null)[] {
  let last: number | null = null
  return stamps.map((ms) => {
    if (ms === null) return null
    const minute = Math.floor(ms / 60_000)
    if (minute === last) return null
    last = minute
    return ms
  })
}

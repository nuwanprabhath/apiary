import { twoDigits } from '@shared/domain/schedule'

const DAY_STEP_MS = 24 * 60 * 60_000

/** "3:05 pm": the clock as people say it, in this machine's zone. */
function spokenClock(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?([AP])M$/i, (_m, p: string) => ` ${p.toLowerCase()}m`)
}

function startOfDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** The day `at` falls on, from where `now` stands: today, tomorrow, yesterday, a weekday this week, else a date. */
function dayWords(at: number, now: number): string {
  const days = Math.round((startOfDay(at) - startOfDay(now)) / DAY_STEP_MS)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  const d = new Date(at)
  if (days > 1 && days < 7) return d.toLocaleDateString(undefined, { weekday: 'long' })
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** "3:05 pm today", "9:00 am tomorrow", "3:05 pm Thursday", "3:05 pm 24 Nov". */
export function whenWords(at: number, now: number): string {
  return `${spokenClock(at)} ${dayWords(at, now)}`
}

/** The value of a `type="date"` field for `at`, local. */
export function dateField(at: number): string {
  const d = new Date(at)
  return `${String(d.getFullYear())}-${twoDigits(d.getMonth() + 1)}-${twoDigits(d.getDate())}`
}

/** The value of a `type="time"` field for `at`, local. */
export function timeField(at: number): string {
  const d = new Date(at)
  return `${twoDigits(d.getHours())}:${twoDigits(d.getMinutes())}`
}

/** The instant a date field and a time field name together, or null while either is incomplete. */
export function fromFields(date: string, time: string): number | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const tm = /^(\d{2}):(\d{2})$/.exec(time)
  if (dm === null || tm === null) return null
  const at = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2])).getTime()
  return Number.isFinite(at) ? at : null
}

/** Tomorrow at 9:00, local. */
export function tomorrowNine(now: number): number {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

/** The message as a chip quotes it: its first line, cut to `max` characters. */
export function quoted(text: string, max = 40): string {
  const line = text.trim().split('\n')[0] ?? ''
  return `“${line.length > max ? `${line.slice(0, max - 1)}…` : line}”`
}

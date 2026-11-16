import { closeSync, fstatSync, openSync, readSync } from 'node:fs'
import { ignoreErrors } from '@shared/ignoreErrors'
import { decodeEntry } from '../transcript/claudeEntry'

/**
 * Claude Code's limit line, as it writes it into the session file (a `<synthetic>` assistant
 * message): "You've hit your session limit · resets 12pm (Australia/Adelaide)", or with a date,
 * "You've hit your weekly limit · resets Oct 29 at 2:30am (Australia/Adelaide)". The zone may be
 * absent, then the time is this machine's.
 */
const LIMIT_LINE = /hit your [\w -]*limit · resets (?:([A-Z][a-z]{2}) (\d{1,2}) at )?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?: \(([^)]+)\))?/i
const MONTH_ABBREVIATIONS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const ONE_DAY_MS = 24 * 60 * 60_000

interface Wall { year: number; month: number; day: number; hour: number; minute: number }

/** The wall clock in `zone` (this machine's when undefined) at `instant`. */
function wallAt(instant: number, zone: string | undefined): Wall {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(instant))
  const part = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { year: part('year'), month: part('month'), day: part('day'), hour: part('hour'), minute: part('minute') }
}

/** The instant a wall-clock time in `zone` names (the later reading, across a DST change). */
function instantOf(wall: Wall, zone: string | undefined): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  const offsetAt = (instant: number): number => {
    const w = wallAt(instant, zone)
    return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute) - Math.floor(instant / 60_000) * 60_000
  }
  const first = asUtc - offsetAt(asUtc)
  return asUtc - offsetAt(first)
}

function knownZone(zone: string | undefined): string | undefined {
  if (zone === undefined) return undefined
  return ignoreErrors(() => { wallAt(0, zone); return zone }, 'an unknown zone name: the time is read as this machine\'s')
}

/**
 * When the limit in `text` resets, read against `sentAt` (when Claude wrote the line): the first
 * such wall-clock time at or after it, in the line's zone. Null when `text` is not a limit line.
 */
export function parseLimitReset(text: string, sentAt: number): number | null {
  const m = LIMIT_LINE.exec(text)
  if (m === null) return null
  const [, monthName, dayText, hourText = '0', minuteText, meridiem = 'am', zoneName] = m
  const zone = knownZone(zoneName)
  const hour12 = Number(hourText) % 12
  const hour = meridiem.toLowerCase() === 'pm' ? hour12 + 12 : hour12
  const minute = minuteText === undefined ? 0 : Number(minuteText)
  if (hour > 23 || minute > 59) return null
  const now = wallAt(sentAt, zone)
  // A line written in the minute the window turns over still means that minute.
  const earliest = sentAt - 60_000
  if (monthName !== undefined && dayText !== undefined) {
    const month = MONTH_ABBREVIATIONS.indexOf(monthName.toLowerCase()) + 1
    if (month === 0) return null
    const at = instantOf({ year: now.year, month, day: Number(dayText), hour, minute }, zone)
    return at >= earliest ? at : instantOf({ year: now.year + 1, month, day: Number(dayText), hour, minute }, zone)
  }
  const today = instantOf({ ...now, hour, minute }, zone)
  if (today >= earliest) return today
  const tomorrow = wallAt(today + ONE_DAY_MS, zone)
  return instantOf({ ...tomorrow, hour, minute }, zone)
}

/** Five minutes after a limit resets: the slack lets the new window open before the message goes. */
export const AFTER_RESET_MS = 5 * 60_000

const TAIL_BYTES = 256 * 1024

/** The end of a session file: the limit line, when there is one, is among its last messages. */
function sessionFileTail(file: string): string {
  const fd = openSync(file, 'r')
  try {
    const size = fstatSync(fd).size
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    return buffer.toString('utf8')
  } finally {
    closeSync(fd)
  }
}

/** The text and time of a `<synthetic>` assistant message (Claude Code's own notice), or null. */
function syntheticText(line: string): { text: string; at: number } | null {
  if (!line.includes('<synthetic>') || !line.includes('hit your')) return null
  const entry = decodeEntry(line)
  const blocks = entry?.message?.content
  if (entry?.type !== 'assistant' || entry.timestamp === undefined || !Array.isArray(blocks)) return null
  const text = blocks.map((b) => (b.type === 'text' ? b.text ?? '' : '')).join(' ')
  const at = Date.parse(entry.timestamp)
  return Number.isFinite(at) ? { text, at } : null
}

/** When the session's last "You've hit your limit" line says the limit resets; null when it has none. */
export function limitResetInTranscript(file: string): number | null {
  const tail = ignoreErrors(() => sessionFileTail(file), 'a session file that is gone') ?? ''
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const found = syntheticText(lines[i] ?? '')
    if (found === null) continue
    const at = parseLimitReset(found.text, found.at)
    if (at !== null) return at
  }
  return null
}

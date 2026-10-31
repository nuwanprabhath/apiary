import type { ResidentSchedule } from './domain/residents'

/**
 * When a resident is on duty: its days (0 = Sunday) and a local `HH:MM` window. An end at or before
 * the start crosses midnight, and that window belongs to the day it starts on (Friday 22:00–02:00
 * covers Friday night into Saturday morning). Pure, so the service's timer is the only clock.
 */

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function isOnDuty(schedule: ResidentSchedule, now: Date): boolean {
  if (schedule.days.length === 0) return false
  const start = minutesOf(schedule.start)
  const end = minutesOf(schedule.end)
  const minute = now.getHours() * 60 + now.getMinutes()
  const today = now.getDay()
  const yesterday = (today + 6) % 7
  if (end > start) return schedule.days.includes(today) && minute >= start && minute < end
  return (schedule.days.includes(today) && minute >= start) || (schedule.days.includes(yesterday) && minute < end)
}

/** The moment `isOnDuty` next flips after `now`, or null for a schedule that is never on or always on. */
export function nextChange(schedule: ResidentSchedule, now: Date): Date | null {
  const current = isOnDuty(schedule, now)
  const start = minutesOf(schedule.start)
  const end = minutesOf(schedule.end)
  // Duty only ever flips at a start or an end; a week and a day of them is every case.
  const candidates: Date[] = []
  for (let offset = 0; offset <= 8; offset++) {
    for (const minute of [start, end]) {
      candidates.push(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, Math.floor(minute / 60), minute % 60))
    }
  }
  candidates.sort((a, b) => a.getTime() - b.getTime())
  return candidates.find((t) => t.getTime() > now.getTime() && isOnDuty(schedule, t) !== current) ?? null
}

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const pad2 = (n: number): string => String(n).padStart(2, '0')

/** "On duty now", or "Off duty — next on Mon 09:00" (just "Off duty" when it never turns on). */
export function dutyStatusText(schedule: ResidentSchedule, now: Date): string {
  if (isOnDuty(schedule, now)) return 'On duty now'
  const next = nextChange(schedule, now)
  if (next === null) return 'Off duty'
  return `Off duty — next on ${dayClock(next)}`
}

/** "Mon 09:00". */
export const dayClock = (at: Date): string => `${DAY_NAMES[at.getDay()]} ${pad2(at.getHours())}:${pad2(at.getMinutes())}`

/** "14:45" when `at` is on `now`'s day, else "Mon 09:00". */
export function clockText(at: Date, now: Date): string {
  return at.toDateString() === now.toDateString() ? `${pad2(at.getHours())}:${pad2(at.getMinutes())}` : dayClock(at)
}

import { WAITING_FOR_OK, type ResidentSchedule, type ResidentStatus } from '@shared/domain/residents'
import { clockText, dayClock, nextChange } from '@shared/residentSchedule'

/** One labelled line of the badge's hover card. */
export interface CardLine {
  label: 'Now' | 'Needs you' | 'Checks' | 'Digest' | 'Setup'
  text: string
}

/** "Every 15 min · next at 14:45", "Every 15 min · next on Mon 09:15", or "Running a check now". */
function checksText(cycle: NonNullable<ResidentStatus['cycle']>, now: Date): string {
  if (cycle.running) return 'Running a check now'
  const every = `Every ${String(cycle.everyMinutes)} min`
  if (cycle.nextAt === null) return every
  const at = new Date(cycle.nextAt)
  const when = clockText(at, now)
  return `${every} · ${when === dayClock(at) ? `next on ${when}` : `next at ${when}`}`
}

function nowText(resident: ResidentStatus, schedule: ResidentSchedule | null, now: Date): string {
  if (resident.state === 'working') return resident.activity ?? 'Working…'
  if (resident.state === 'idle') return 'Idle'
  if (!resident.enabled) return 'Asleep (turned off)'
  const back = schedule === null ? null : nextChange(schedule, now)
  return back === null ? 'Asleep (off duty)' : `Asleep (off duty until ${dayClock(back)})`
}

/** What the card says under the name and blurb, in order; a line with nothing to say is left out. */
export function residentCardLines(resident: ResidentStatus, schedule: ResidentSchedule | null, now: Date): CardLine[] {
  const lines: CardLine[] = [{ label: 'Now', text: nowText(resident, schedule, now) }]
  const waiting = resident.permissions.length
  if (resident.attention !== null) lines.push({ label: 'Needs you', text: resident.attention.summary })
  else if (waiting > 0) lines.push({ label: 'Needs you', text: `${String(waiting)} · ${WAITING_FOR_OK}` })
  if (resident.cycle !== null) lines.push({ label: 'Checks', text: checksText(resident.cycle, now) })
  if (resident.digest !== null) lines.push({ label: 'Digest', text: `${String(resident.digest.done)} of ${String(resident.digest.total)}` })
  if (resident.setupNeeded !== null) lines.push({ label: 'Setup', text: resident.setupNeeded })
  return lines
}

import { isOnDuty, nextChange } from '@shared/residentSchedule'
import type { Resident } from './residentStatus'

/** When each enabled resident next needs the service: a schedule boundary, its idle stop or its cycle (epoch ms). */
export function dueTimes(residents: Iterable<Resident>, now: Date, idleStopMs: number): number[] {
  const due: number[] = []
  for (const r of residents) {
    if (!r.config.enabled) continue
    const change = nextChange(r.config.schedule, now)
    if (change !== null) due.push(change.getTime())
    if (r.chat.running && r.holds.length === 0 && !isOnDuty(r.config.schedule, now)) due.push(r.chat.lastActive + idleStopMs)
    if (r.nextCycleAt !== null) due.push(r.nextCycleAt)
  }
  return due
}

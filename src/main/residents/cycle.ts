import type { ResidentConfig, ResidentCycle } from '@shared/domain/residents'
import { isOnDuty, nextChange } from '@shared/residentSchedule'
import type { ResidentKind } from './kindTypes'

const MINUTE_MS = 60 * 1000

/** How often the resident's cycle runs: its own setting, else its kind's; null for a kind without a cycle. */
export function cycleMinutesOf(kind: ResidentKind, config: ResidentConfig): number | null {
  if (kind.cycle === undefined) return null
  return config.cycleEveryMinutes ?? kind.cycle.everyMinutes
}

/**
 * The cycle as the status reports it. On duty, `nextAt` is the service's timer; off duty it is the
 * first cycle after the schedule next comes on duty; disabled, or with no duty ahead, null.
 */
export function cycleStatus(kind: ResidentKind, config: ResidentConfig, at: { nextCycleAt: number | null; running: boolean; now: Date }): ResidentCycle | null {
  const everyMinutes = cycleMinutesOf(kind, config)
  if (everyMinutes === null) return null
  let nextAt: number | null = null
  if (config.enabled && isOnDuty(config.schedule, at.now)) nextAt = at.nextCycleAt
  else if (config.enabled) {
    const onDuty = nextChange(config.schedule, at.now)
    nextAt = onDuty === null ? null : onDuty.getTime() + everyMinutes * MINUTE_MS
  }
  return { everyMinutes, nextAt, running: at.running }
}

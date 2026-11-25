import type { ResidentConfig } from '@shared/domain/residents'
import { isOnDuty } from '@shared/residentSchedule'
import { log } from '../log/logger'
import { cycleMinutesOf, MINUTE_MS } from './cycle'
import type { ResidentKind } from './kindTypes'
import { cycleSkip } from './quickActions'

/** A cycle that found its resident busy or waiting on the user tries again this much later. */
const CYCLE_RETRY_MS = 60 * 1000

/** What `cycleDue` reads of a resident, and the timer fields it moves. */
export interface CycleState {
  kind: ResidentKind
  config: ResidentConfig
  chat: { busy: boolean; permissions(): readonly unknown[] }
  cycleEvery: number | null
  nextCycleAt: number | null
  cycleSkipLogged: string | null
}

/**
 * Moves the resident's cycle timer on and says whether its cycle prompt goes now. A skip is logged
 * once per reason; a skipped cycle retries a minute later, or a whole cycle later for missing setup.
 */
export function cycleDue(r: CycleState, now: Date, consent: boolean): boolean {
  const minutes = cycleMinutesOf(r.kind, r.config)
  if (r.kind.cycle === undefined || minutes === null) return false
  const every = minutes * MINUTE_MS
  if (r.cycleEvery !== minutes) {
    r.cycleEvery = minutes
    r.nextCycleAt = null
  }
  const skip = cycleSkip({
    enabled: r.config.enabled,
    onDuty: isOnDuty(r.config.schedule, now),
    busy: r.chat.busy,
    permissionsWaiting: r.chat.permissions().length,
    setupNeeded: r.kind.setup(r.config),
    consent,
  })
  if (skip === 'off duty') {
    r.nextCycleAt = null
    return false
  }
  if (r.nextCycleAt === null) {
    r.nextCycleAt = now.getTime() + every
    return false
  }
  if (now.getTime() < r.nextCycleAt) return false
  if (skip !== null) {
    if (r.cycleSkipLogged !== skip) log.info('residents', 'cycle skipped', { resident: r.config.id, reason: skip })
    r.cycleSkipLogged = skip
    r.nextCycleAt = now.getTime() + (skip === 'setup needed' ? every : CYCLE_RETRY_MS)
    return false
  }
  r.cycleSkipLogged = null
  r.nextCycleAt = now.getTime() + every
  return true
}

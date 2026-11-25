import { errorMessage } from '@shared/errors'
import { log } from '../log/logger'

const RETENTION_DAY_MS = 24 * 60 * 60 * 1000
export const FIRST_SWEEP_MS = 60_000
export const SWEEP_EVERY_MS = RETENTION_DAY_MS
const AWAITING_KEPT_MS = RETENTION_DAY_MS
/** A resident folder no setting names is removed only after nothing in it changed for this long. */
const ORPHAN_GRACE_MS = 7 * RETENTION_DAY_MS

export const SWEEP_STEPS = [
  'missingDigests', 'oldDigests', 'pastedImages', 'scheduledLogs', 'residentHistory', 'slackAwaiting', 'orphanResidents',
] as const
export type SweepStep = (typeof SWEEP_STEPS)[number]
/** How many things each step removed; `failed` and `skipped` steps removed nothing. */
export type SweepReport = Record<SweepStep, number | 'failed' | 'skipped'>

export interface RetentionSweeperDeps {
  settings: () => { dataRetentionDays: number; residents: { id: string }[] }
  knowledge: { forgetMissing(live: Set<string>): number; forgetOlderThan(cutoffMs: number): number } | null
  /** Ids of sessions that exist and are not archived. */
  liveSessionIds: () => Set<string>
  images: { pruneOlderThan(cutoffMs: number, referenced: (sinceMs: number) => Promise<Set<string>>): Promise<number> }
  /** Image file names a live transcript last modified at or after `sinceMs` still names. */
  referencedImages: (sinceMs: number) => Promise<Set<string>>
  scheduled: { pruneFinished(cutoffMs: number): number }
  residentsDir: string
  residentSpace: {
    pruneHistoryOlderThan(id: string, cutoffMs: number): number
    removeOrphans(dir: string, liveIds: Set<string>, untouchedSinceMs: number): Promise<string[]>
  }
  /** null where the awaiting list is not reachable from here (it lives in the Slack store). */
  slackAwaiting: { dropOlderThan(cutoffMs: number): number } | null
  now: () => number
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (timer: unknown) => void
}

export interface RetentionSweeper {
  start(): void
  stop(): void
  runOnce(): Promise<SweepReport>
}

/**
 * Enforces `dataRetentionDays` on what Apiary keeps of its own, strict mode or not. Every step is
 * isolated, and only counts are logged.
 */
export function createRetentionSweeper(deps: RetentionSweeperDeps): RetentionSweeper {
  let timer: unknown = null
  let running = false

  const steps = (cutoff: number): Record<SweepStep, (() => Promise<number>) | null> => ({
    missingDigests: deps.knowledge === null ? null : async () => deps.knowledge?.forgetMissing(deps.liveSessionIds()) ?? 0,
    oldDigests: deps.knowledge === null ? null : async () => deps.knowledge?.forgetOlderThan(cutoff) ?? 0,
    pastedImages: async () => deps.images.pruneOlderThan(cutoff, deps.referencedImages),
    scheduledLogs: async () => deps.scheduled.pruneFinished(cutoff),
    residentHistory: async () => deps.settings().residents
      .reduce((n, r) => n + deps.residentSpace.pruneHistoryOlderThan(r.id, cutoff), 0),
    slackAwaiting: deps.slackAwaiting === null ? null : async () => deps.slackAwaiting?.dropOlderThan(deps.now() - AWAITING_KEPT_MS) ?? 0,
    orphanResidents: async () => (await deps.residentSpace.removeOrphans(
      deps.residentsDir, new Set(deps.settings().residents.map((r) => r.id)), deps.now() - ORPHAN_GRACE_MS,
    )).length,
  })

  const runOnce = async (): Promise<SweepReport> => {
    const cutoff = deps.now() - deps.settings().dataRetentionDays * RETENTION_DAY_MS
    const report = {} as SweepReport
    for (const [step, run] of Object.entries(steps(cutoff)) as [SweepStep, (() => Promise<number>) | null][]) {
      if (run === null) { report[step] = 'skipped'; continue }
      try {
        report[step] = await run()
      } catch (e) {
        report[step] = 'failed'
        log.warn('privacy', 'a retention step failed', { step, error: errorMessage(e) })
      }
    }
    log.info('privacy', 'retention sweep', report)
    return report
  }

  const schedule = (ms: number): void => {
    timer = deps.setTimer(() => {
      if (running) { schedule(SWEEP_EVERY_MS); return }
      running = true
      void runOnce().finally(() => {
        running = false
        if (timer !== null) schedule(SWEEP_EVERY_MS)
      })
    }, ms)
  }

  return {
    start: () => { if (timer === null) schedule(FIRST_SWEEP_MS) },
    stop: () => {
      if (timer !== null) deps.clearTimer(timer)
      timer = null
    },
    runOnce,
  }
}

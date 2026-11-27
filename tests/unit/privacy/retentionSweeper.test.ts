import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRetentionSweeper, FIRST_SWEEP_MS, SWEEP_EVERY_MS, type RetentionSweeperDeps } from '../../../src/main/privacy/retentionSweeper'
import { ImageStore } from '../../../src/main/media/imageStore'
import { ScheduledJobs } from '../../../src/main/schedule/scheduledJobs'
import { ResidentSpace } from '../../../src/main/residents/residentSpace'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.now()
let root: string

const aged = (file: string, days: number): void => {
  const t = (NOW - days * DAY) / 1000
  utimesSync(file, t, t)
}

/**
 * Dates everything under `dir` at the test's NOW. The kernel stamps a new file with the machine's
 * time, which is not the process's under `faketime` (the nightly clock job): there a file just
 * written was over a month old, and was swept.
 */
const stampedNow = (dir: string): void => {
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true })) aged(join(e.parentPath, e.name), 0)
  aged(dir, 0)
}

const world = (over: Partial<RetentionSweeperDeps> = {}): RetentionSweeperDeps & { forgotten: string[] } => {
  const forgotten: string[] = []
  const residentsDir = join(root, 'residents')
  return {
    forgotten,
    settings: () => ({ dataRetentionDays: 30, residents: [{ id: 'regent' }] }),
    knowledge: {
      forgetMissing: (live) => { forgotten.push(`missing:${[...live].join(',')}`); return 2 },
      forgetOlderThan: (cutoff) => { forgotten.push(`older:${String(NOW - cutoff)}`); return 1 },
    },
    liveSessionIds: () => new Set(['s1']),
    images: new ImageStore({ dir: join(root, 'pasted-images') }),
    referencedImages: async () => new Set(['kept.png']),
    scheduled: new ScheduledJobs(root),
    residentsDir,
    residentSpace: {
      pruneHistoryOlderThan: (id, cutoff) => new ResidentSpace(residentsDir, id).pruneHistoryOlderThan(cutoff),
      removeOrphans: (dir, live, cutoff) => ResidentSpace.removeOrphans(dir, live, cutoff),
    },
    slackAwaiting: null,
    now: () => NOW,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (t) => { clearTimeout(t as NodeJS.Timeout) },
    ...over,
  }
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'apiary-sweep-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('the retention sweeper', () => {
  it('drops digests of missing sessions and digests older than the retention', async () => {
    const w = world()
    const report = await createRetentionSweeper(w).runOnce()
    expect(w.forgotten).toEqual(['missing:s1', `older:${String(30 * DAY)}`])
    expect(report).toMatchObject({ missingDigests: 2, oldDigests: 1, slackAwaiting: 'skipped' })
  })

  it('removes old pasted images no live transcript names', async () => {
    const dir = join(root, 'pasted-images')
    mkdirSync(dir)
    for (const n of ['old.png', 'kept.png', 'new.png']) writeFileSync(join(dir, n), 'x')
    stampedNow(dir)
    aged(join(dir, 'old.png'), 40)
    aged(join(dir, 'kept.png'), 40)
    expect((await createRetentionSweeper(world()).runOnce()).pastedImages).toBe(1)
    expect([existsSync(join(dir, 'old.png')), existsSync(join(dir, 'kept.png')), existsSync(join(dir, 'new.png'))]).toEqual([false, true, true])
  })

  it('reads no transcript when no image is older than the retention, and otherwise only those written since the oldest old image', async () => {
    const dir = join(root, 'pasted-images')
    mkdirSync(dir)
    writeFileSync(join(dir, 'new.png'), 'x')
    stampedNow(dir)
    const asked: number[] = []
    const w = world({ referencedImages: async (since) => { asked.push(since); return new Set() } })
    await createRetentionSweeper(w).runOnce()
    expect(asked).toEqual([])
    for (const [n, days] of [['a.png', 40], ['b.png', 50]] as const) { writeFileSync(join(dir, n), 'x'); aged(join(dir, n), days) }
    await createRetentionSweeper(w).runOnce()
    expect(asked).toHaveLength(1)
    expect(Math.round((NOW - (asked[0] ?? 0)) / DAY)).toBe(50)
  })

  it('removes old finished schedule logs but never a pending schedule', async () => {
    const dir = join(root, 'scheduled')
    mkdirSync(dir)
    for (const n of ['a.log', 'a.done', 'p.vars', 'p.log', 'b.log']) { writeFileSync(join(dir, n), 'x'); aged(join(dir, n), 40) }
    aged(join(dir, 'b.log'), 1)
    expect((await createRetentionSweeper(world()).runOnce()).scheduledLogs).toBe(2)
    expect(['a.log', 'a.done', 'p.vars', 'p.log', 'b.log'].map((n) => existsSync(join(dir, n)))).toEqual([false, false, true, true, true])
  })

  it('drops resident history entries older than the retention', async () => {
    const space = new ResidentSpace(join(root, 'residents'), 'regent')
    space.saveHistory([
      { id: '1', role: 'user', text: 'old', at: NOW - 40 * DAY, streaming: false },
      { id: '2', role: 'user', text: 'new', at: NOW - DAY, streaming: false },
    ])
    expect((await createRetentionSweeper(world()).runOnce()).residentHistory).toBe(1)
    expect(space.loadHistory().map((m) => m.id)).toEqual(['2'])
  })

  it('removes orphan resident folders, never a symlink or an odd name', async () => {
    const dir = join(root, 'residents')
    const outside = join(root, 'outside')
    for (const d of [join(dir, 'regent'), join(dir, 'gone'), join(dir, 'Not_A_Slug'), outside]) mkdirSync(d, { recursive: true })
    writeFileSync(join(outside, 'keep'), 'x')
    aged(join(dir, 'gone'), 8)
    aged(join(dir, 'regent'), 400)
    symlinkSync(outside, join(dir, 'linked'))
    expect((await createRetentionSweeper(world()).runOnce()).orphanResidents).toBe(1)
    expect(['regent', 'gone', 'Not_A_Slug', 'linked'].map((n) => existsSync(join(dir, n)))).toEqual([true, false, true, true])
    expect(existsSync(join(outside, 'keep'))).toBe(true)
  })

  it('keeps an orphan folder anything inside was written to in the last 7 days', async () => {
    const dir = join(root, 'residents')
    for (const d of ['fresh', 'fresh-deep/sub', 'old/sub']) mkdirSync(join(dir, d), { recursive: true })
    writeFileSync(join(dir, 'fresh-deep', 'sub', 'history.json'), '{}')
    writeFileSync(join(dir, 'old', 'sub', 'history.json'), '{}')
    stampedNow(dir)
    for (const p of ['fresh-deep/sub', 'fresh-deep', 'old/sub/history.json', 'old/sub', 'old']) aged(join(dir, p), 30)
    expect((await createRetentionSweeper(world()).runOnce()).orphanResidents).toBe(1)
    expect(['fresh', 'fresh-deep', 'old'].map((n) => existsSync(join(dir, n)))).toEqual([true, true, false])
  })

  it('keeps going when one step fails', async () => {
    const report = await createRetentionSweeper(world({
      knowledge: { forgetMissing: () => { throw new Error('db locked') }, forgetOlderThan: () => 0 },
    })).runOnce()
    expect(report.missingDigests).toBe('failed')
    expect(report.orphanResidents).toBe(0)
  })

  it('first runs after 60 seconds, then every 24 hours, until stopped', async () => {
    const delays: number[] = []
    const fns: (() => void)[] = []
    const sweeper = createRetentionSweeper(world({
      setTimer: (fn, ms) => { delays.push(ms); fns.push(fn); return fns.length },
      clearTimer: () => undefined,
    }))
    sweeper.start()
    expect(delays).toEqual([FIRST_SWEEP_MS])
    fns[0]?.()
    await expect.poll(() => delays).toEqual([FIRST_SWEEP_MS, SWEEP_EVERY_MS])
    sweeper.stop()
  })
})

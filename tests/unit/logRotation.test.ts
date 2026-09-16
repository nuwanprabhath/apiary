import { describe, it, expect } from 'vitest'
import { filesToPrune, shouldRotate, type LogFile } from '../../src/main/log/rotation'

const DAY = 24 * 60 * 60 * 1000
const now = 1_000 * DAY
const MB = 1024 * 1024

const file = (name: string, days: number, mb: number): LogFile =>
  ({ name, modifiedMs: now - days * DAY, bytes: mb * MB })

const opts = (over: Partial<Parameters<typeof filesToPrune>[1]> = {}) => ({
  now, retentionDays: 7, budgetBytes: 20 * MB, activeName: 'apiary.log', ...over,
})

describe('pruning log files', () => {
  it('deletes files older than the retention period', () => {
    const files = [file('apiary.log', 0, 1), file('apiary-old.log', 9, 1), file('apiary-recent.log', 2, 1)]
    expect(filesToPrune(files, opts())).toEqual(['apiary-old.log'])
  })

  it('never deletes the file being written, however old it is', () => {
    // Deleting the active file is the classic rotation bug: writes then vanish into a handle on
    // a file that no longer has a name.
    expect(filesToPrune([file('apiary.log', 400, 1)], opts())).toEqual([])
  })

  it('deletes oldest-first when the size budget is exceeded, even inside the retention period', () => {
    // The two promises disagree here — everything is recent, and together they are over budget.
    // The budget wins, because it is the one protecting the machine.
    const files = [
      file('apiary.log', 0, 8),
      file('apiary-a.log', 3, 8),
      file('apiary-b.log', 1, 8),
    ]
    expect(filesToPrune(files, opts())).toEqual(['apiary-a.log'])
  })

  it('counts the active file against the budget, since the promise is about total disk', () => {
    const files = [file('apiary.log', 0, 19), file('apiary-a.log', 1, 4)]
    expect(filesToPrune(files, opts())).toEqual(['apiary-a.log'])
  })

  it('does not delete anything when comfortably inside both limits', () => {
    expect(filesToPrune([file('apiary.log', 0, 1), file('apiary-a.log', 1, 1)], opts())).toEqual([])
  })

  it('counts an age-deleted file as already gone rather than twice', () => {
    const files = [file('apiary.log', 0, 1), file('apiary-old.log', 30, 30), file('apiary-a.log', 1, 1)]
    // The 30MB file goes on age, which puts the rest well inside budget — nothing else follows.
    expect(filesToPrune(files, opts())).toEqual(['apiary-old.log'])
  })
})

describe('rolling the active file aside', () => {
  it('rotates once the active file passes a fifth of the budget', () => {
    expect(shouldRotate(5 * MB, 100, 20 * MB)).toBe(true)
    expect(shouldRotate(3 * MB, 100, 20 * MB)).toBe(false)
  })

  it('never rotates an empty file, which would leave a trail of nothing', () => {
    expect(shouldRotate(0, 10 * MB, 20 * MB)).toBe(false)
  })

  it('keeps a floor, so a small budget still produces files long enough to read', () => {
    // A 1MB budget at a strict fifth would rotate every 200KB — too short to hold one failure.
    expect(shouldRotate(900 * 1024, 100, 1 * MB)).toBe(false)
    expect(shouldRotate(1.5 * MB, 100, 1 * MB)).toBe(true)
  })
})

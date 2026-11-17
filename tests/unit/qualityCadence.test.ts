import { describe, it, expect } from 'vitest'
import { dueMessage, dueReason } from '../../scripts/quality-cadence.mjs'

const skill = { every: { commits: 40, days: 14 }, last: { commit: '6e3a400b2b0bbd8f1f6f9a2a9e0e9a2b6e3a400b', date: '2026-11-07' } }

describe('when a quality skill is due', () => {
  it('is due after its number of commits, as correct was after 158 commits with no run (1.59.9 to 1.70.3)', () => {
    expect(dueReason('correct', skill, 158, 10)).toBe('correct: 158 commits since its last run (due every 40)')
    expect(dueReason('correct', skill, 39, 10)).toBeNull()
  })

  it('is due after its number of days, once the repo has moved', () => {
    expect(dueReason('correct', skill, 6, 15)).toBe('correct: 15 days and 6 commits since its last run (due every 14 days)')
    expect(dueReason('correct', skill, 2, 60)).toBeNull()
  })

  it('is due when its last run is not on this branch, since nothing then says it ran', () => {
    expect(dueReason('correct', skill, null, 0)).toBe('correct: its last run (6e3a400b) is not on this branch')
  })

  it('says how to clear it', () => {
    expect(dueMessage(['a', 'b'])).toContain('Quality skills due: a; b.')
    expect(dueMessage(['a'])).toContain('node scripts/quality-cadence.mjs done <name>')
  })
})

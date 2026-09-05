import { describe, it, expect } from 'vitest'
import { fuzzyScore } from '../../src/main/tree/fuzzy'

describe('fuzzyScore', () => {
  it('matches a subsequence', () => {
    expect(fuzzyScore('csv', 'Fix missing CSV export')).not.toBeNull()
  })

  it('is case insensitive', () => {
    expect(fuzzyScore('CSV', 'fix csv bug')).not.toBeNull()
  })

  it('returns null when characters are missing', () => {
    expect(fuzzyScore('xyz', 'Fix CSV export')).toBeNull()
  })

  it('returns null when characters are out of order', () => {
    expect(fuzzyScore('vsc', 'csv')).toBeNull()
  })

  it('scores a contiguous match above a scattered one', () => {
    const contiguous = fuzzyScore('export', 'CSV export bug')!
    const scattered = fuzzyScore('export', 'e x p o r t')!
    expect(contiguous).toBeGreaterThan(scattered)
  })

  it('scores a word-start match above a mid-word match', () => {
    const wordStart = fuzzyScore('exp', 'csv export')!
    const midWord = fuzzyScore('exp', 'unexpected')!
    expect(wordStart).toBeGreaterThan(midWord)
  })

  it('matches everything on an empty query', () => {
    expect(fuzzyScore('', 'anything')).not.toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { forkLabel } from '../../src/shared/forkLabel'

describe('forkLabel', () => {
  it('prefixes the original title', () => {
    expect(forkLabel('Fix CSV export bug')).toBe('fork: Fix CSV export bug')
  })

  it('nests the prefix when forking a fork, rather than collapsing it', () => {
    // Honest about the chain: the second fork really did come from the first, not from the
    // original, and collapsing to one prefix however deep you go would make a chain of forks
    // indistinguishable from a handful of siblings.
    expect(forkLabel(forkLabel('Fix CSV export bug'))).toBe('fork: fork: Fix CSV export bug')
  })

  it('handles an empty title', () => {
    expect(forkLabel('')).toBe('fork: ')
  })
})

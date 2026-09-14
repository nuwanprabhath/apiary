import { describe, it, expect } from 'vitest'
import { describeRefresh } from '../../src/renderer/state/refreshSummary'

describe('describeRefresh', () => {
  it('says how many sessions the rescan added', () => {
    expect(describeRefresh(4, 6, false)).toBe('Rescanned — 2 new sessions.')
    expect(describeRefresh(4, 5, false)).toBe('Rescanned — 1 new session.')
  })

  it('says plainly when nothing changed, rather than staying silent', () => {
    expect(describeRefresh(4, 4, false)).toBe('Rescanned — no new sessions.')
  })

  it('reports sessions that have gone, not only ones that arrived', () => {
    expect(describeRefresh(4, 3, false)).toBe('Rescanned — 1 session no longer listed.')
  })

  it('counts matches while a search is filtering the list, and says so', () => {
    // Claiming "2 new sessions" while the list only shows what matches "pipeline" would be a
    // number about a list the user is not looking at.
    expect(describeRefresh(1, 3, true)).toBe('Rescanned — 2 new matching sessions.')
    expect(describeRefresh(1, 1, true)).toBe('Rescanned — no change to the matches.')
  })
})

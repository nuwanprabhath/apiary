import { describe, it, expect } from 'vitest'
import { exactRefMatch } from '../../src/renderer/state/branchSelection'
import type { GitRefEntry } from '@shared/types'

const ref = (name: string): GitRefEntry => ({ name, relativeDate: '2h ago', author: 'a', shortSha: 'abc123', subject: 's' })

describe('exactRefMatch', () => {
  it('is null for an empty query, and for a query that only narrows the list', () => {
    const refs = { local: [ref('feature/one')], remote: [] }
    expect(exactRefMatch(refs, '')).toBeNull()
    expect(exactRefMatch(refs, 'feature')).toBeNull()
  })

  it('matches a local branch exactly', () => {
    const refs = { local: [ref('main'), ref('feature/one')], remote: [] }
    expect(exactRefMatch(refs, 'feature/one')).toEqual({ entry: ref('feature/one'), kind: 'local' })
  })

  it('is case-sensitive, as git branch names are', () => {
    const refs = { local: [ref('Main')], remote: [] }
    expect(exactRefMatch(refs, 'main')).toBeNull()
  })

  it('prefers a local branch over a remote one of the same name', () => {
    const refs = { local: [ref('main')], remote: [ref('origin/main')] }
    // The remote entry's name already carries the "origin/" prefix, so this is really testing
    // that an exact match on "main" never falls through to a remote ref that merely contains it.
    expect(exactRefMatch(refs, 'main')).toEqual({ entry: ref('main'), kind: 'local' })
  })

  it('matches a remote branch exactly when there is no local one', () => {
    const refs = { local: [ref('main')], remote: [ref('origin/feature/two')] }
    expect(exactRefMatch(refs, 'origin/feature/two')).toEqual({ entry: ref('origin/feature/two'), kind: 'remote' })
  })

  it('a longer name that merely starts with the query is not a match', () => {
    const refs = { local: [ref('feature/one'), ref('feature/one-extended')], remote: [] }
    expect(exactRefMatch(refs, 'feature/one')?.entry.name).toBe('feature/one')
  })
})

import { describe, expect, it } from 'vitest'
import type { SessionHit, SessionHitReason } from '@shared/domain/residents'
import { asSessionId } from '@shared/domain/ids'
import { instantHits, instantMatchPolicy } from '../../../src/main/residents/instantMatches'

const hit = (title: string, reason: SessionHitReason): SessionHit => ({
  sessionId: asSessionId(title), title, folder: 'app', branch: null, lastActive: 0, reason, topic: null, snippet: null,
})
const HITS = [hit('MR 1175 review', 'ref'), hit('Design the API interface', 'topic'), hit('API notes', 'title'), hit('Logging', 'text')]
const shown = (text: string): string[] => instantHits(instantMatchPolicy(text), HITS).map((h) => h.title)

describe('instantMatchPolicy', () => {
  it('a question or an instruction gets no matches', () => {
    expect(instantMatchPolicy('Can you check it now? I think you have access')).toEqual({ kind: 'none' })
    expect(instantMatchPolicy('Are you watching things in the background?')).toEqual({ kind: 'none' })
    expect(shown('Can you check it now? I think you have access')).toEqual([])
  })

  it('a ref gets only the ref hits', () => {
    expect(instantMatchPolicy('Open the session for !1175').kind).toBe('refs')
    expect(shown('Open the session for !1175')).toEqual(['MR 1175 review'])
    expect(shown('what happened in https://gitlab.com/g/p/-/merge_requests/1175')).toEqual(['MR 1175 review'])
    expect(instantMatchPolicy('where is ABC-123 at').kind).toBe('refs')
  })

  it('a lookup gets the top three, with a title hit only when it has every word asked for', () => {
    expect(instantMatchPolicy('bring up the session where we designed the API interface').kind).toBe('lookup')
    expect(shown('bring up the session where we designed the API interface')).toEqual(['MR 1175 review', 'Design the API interface', 'Logging'])
    expect(shown('find the API notes')).toEqual(['MR 1175 review', 'Design the API interface', 'API notes'])
  })

  it('knows each lookup phrase', () => {
    for (const text of ['open auth', 'find auth', 'bring up auth', 'show me auth', 'pull up auth', 'which session had auth',
      'where did we do auth', 'where was auth', 'the session about auth', 'look for auth']) {
      expect(instantMatchPolicy(text).kind).toBe('lookup')
    }
  })
})

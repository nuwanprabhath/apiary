import { describe, expect, it } from 'vitest'
import { treeChangeConcerns, treeChangeOfPaths } from '@shared/domain/session'
import { asSessionId } from '@shared/domain/ids'

const A = asSessionId('11111111-1111-4111-8111-111111111111')
const B = asSessionId('22222222-2222-4222-8222-222222222222')

describe('treeChangeOfPaths', () => {
  it('names the session of a <uuid>.jsonl path', () => {
    expect(treeChangeOfPaths([`/p/-proj/${A}.jsonl`, `C:\\p\\${B}.jsonl`])).toEqual({ sessions: [A, B] })
  })

  it('is unknown for a file that is not a session transcript', () => {
    expect(treeChangeOfPaths(['/p/-proj/notes.txt'])).toEqual({ sessions: null })
    expect(treeChangeOfPaths(['/p/-proj/agent-1.jsonl'])).toEqual({ sessions: null })
  })

  it('is unknown when a session file is mixed with another file', () => {
    expect(treeChangeOfPaths([`/p/${A}.jsonl`, '/p/other.json'])).toEqual({ sessions: null })
  })
})

describe('treeChangeConcerns', () => {
  it('a listed session is concerned, an unlisted one is not', () => {
    expect(treeChangeConcerns({ sessions: [A] }, A)).toBe(true)
    expect(treeChangeConcerns({ sessions: [A] }, B)).toBe(false)
  })

  it('an unknown or missing change concerns every session', () => {
    expect(treeChangeConcerns({ sessions: null }, B)).toBe(true)
    expect(treeChangeConcerns(undefined, B)).toBe(true)
  })
})

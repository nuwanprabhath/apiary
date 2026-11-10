import { describe, expect, it } from 'vitest'
import { decodeEntry, entryOf } from '../../src/main/transcript/claudeEntry'
import { ENTRY_SHAPES } from '../fixtures/jsonlCorpus'

describe('decodeEntry', () => {
  it('is null for a line that is not a JSON object', () => {
    for (const line of ['', 'not json {', '42', '"text"', 'null', '[1,2]', '{"type":"user"']) {
      expect(decodeEntry(line)).toBeNull()
    }
  })

  it('decodes a user entry with its message blocks', () => {
    const e = decodeEntry(JSON.stringify({
      type: 'user', uuid: 'u1', timestamp: '2026-09-01T10:00:00.000Z', cwd: '/w', gitBranch: 'main',
      isSidechain: true, isMeta: true, sourceToolUseID: 't1',
      message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: true }, 7] },
    }))
    expect(e).toMatchObject({
      type: 'user', uuid: 'u1', cwd: '/w', gitBranch: 'main', isSidechain: true, isMeta: true, sourceToolUseID: 't1',
      message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_result', toolUseId: 't1', content: 'ok', isError: true }] },
    })
  })

  it('turns a field of the wrong type into undefined, never a throw', () => {
    const e = decodeEntry(JSON.stringify({
      type: 'assistant', uuid: 5, timestamp: {}, cwd: [], isSidechain: 'yes',
      message: { content: [{ type: 'text', text: 3 }, { type: 'tool_use', id: 1, name: null, input: { a: 1 } }] },
    }))
    expect(e).toMatchObject({ type: 'assistant', uuid: undefined, timestamp: undefined, cwd: undefined, isSidechain: false })
    expect(e?.type === 'assistant' ? e.message?.content : null).toEqual([
      { type: 'text', text: undefined },
      { type: 'tool_use', id: undefined, name: undefined, input: { a: 1 } },
    ])
    expect(decodeEntry('{"type":"user","message":"flat"}')).toMatchObject({ type: 'user', message: undefined })
    expect(decodeEntry('{"type":7}')).toMatchObject({ type: 'other', rawType: undefined })
  })

  it('decodes each kind with its own fields', () => {
    expect(decodeEntry('{"type":"custom-title","customTitle":"Mine"}')).toMatchObject({ type: 'custom-title', customTitle: 'Mine' })
    expect(decodeEntry('{"type":"ai-title","aiTitle":"Theirs"}')).toMatchObject({ type: 'ai-title', aiTitle: 'Theirs' })
    expect(decodeEntry('{"type":"system","subtype":"turn_duration","durationMs":12}')).toMatchObject({ type: 'system', subtype: 'turn_duration', durationMs: 12 })
    expect(decodeEntry('{"type":"queue-operation","operation":"enqueue","content":"x"}')).toMatchObject({ type: 'queue-operation', operation: 'enqueue', content: 'x' })
    expect(decodeEntry('{"type":"summary","title":"T"}')).toMatchObject({ type: 'other', rawType: 'summary', title: 'T' })
  })

  it('entryOf decodes an object already parsed (stream-json carries the same entries)', () => {
    expect(entryOf({ type: 'ai-title', aiTitle: 'A' })).toMatchObject({ type: 'ai-title', aiTitle: 'A' })
    expect(entryOf('nope')).toBeNull()
  })

  it.each(ENTRY_SHAPES.map((s) => [s.name, s] as const))('decodes the recorded shape %s', (_name, shape) => {
    expect(decodeEntry(shape.line)).toMatchObject(shape.decoded)
  })
})

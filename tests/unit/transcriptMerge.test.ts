import { describe, it, expect } from 'vitest'
import { mergeLatestPage } from '../../src/renderer/state/transcriptMerge'
import type { TranscriptMessage } from '@shared/types'

const msg = (uuid: string, text = uuid): TranscriptMessage => ({
  uuid, role: 'user', timestampMs: null, isSidechain: false, blocks: [{ type: 'text', text }],
})

describe('mergeLatestPage (UI-8)', () => {
  it('appends only what is genuinely new when the tail overlaps the new page', () => {
    const existing = [msg('a'), msg('b'), msg('c')]
    const incoming = [msg('b'), msg('c'), msg('d')]
    const merged = mergeLatestPage(existing, incoming)
    expect(merged.map((m) => m.uuid)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the same array reference when nothing new arrived — this is what lets MessageRow bail via memo', () => {
    const existing = [msg('a'), msg('b')]
    const incoming = [msg('a'), msg('b')]
    const merged = mergeLatestPage(existing, incoming)
    expect(merged).toBe(existing)
  })

  it('keeps every existing message object identity, not just the array', () => {
    const a = msg('a')
    const b = msg('b')
    const merged = mergeLatestPage([a, b], [b, msg('c')])
    expect(merged[0]).toBe(a)
    expect(merged[1]).toBe(b)
  })

  it('appends the whole incoming page when no overlap is found at all', () => {
    const existing = [msg('a')]
    const incoming = [msg('x'), msg('y')]
    expect(mergeLatestPage(existing, incoming).map((m) => m.uuid)).toEqual(['a', 'x', 'y'])
  })

  it('falls back to structural comparison for messages with no uuid, at corresponding positions', () => {
    const shared = msg('', 'same content')
    const existing = [msg('a'), shared]
    const incoming = [shared, msg('c')]
    expect(mergeLatestPage(existing, incoming).map((m) => m.uuid)).toEqual(['a', '', 'c'])
  })

  it('starts from an empty transcript by appending the whole first page', () => {
    const incoming = [msg('a'), msg('b')]
    expect(mergeLatestPage([], incoming)).toEqual(incoming)
  })
})

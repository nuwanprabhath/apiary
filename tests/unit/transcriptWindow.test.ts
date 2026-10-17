import { describe, it, expect } from 'vitest'
import { HELD_KEEP, HELD_MAX, windowHeld } from '../../src/renderer/state/transcriptWindow'
import type { TranscriptMessage } from '@shared/types'

const msg = (i: number, over: Partial<TranscriptMessage> = {}): TranscriptMessage => ({
  uuid: 'm' + String(i), role: 'assistant', timestampMs: null, isSidechain: false, index: i,
  blocks: [{ type: 'text', text: 'x' }], ...over,
})
const run = (n: number): TranscriptMessage[] => Array.from({ length: n }, (_, i) => msg(i))
const toolResult = (i: number): TranscriptMessage =>
  msg(i, { role: 'user', blocks: [{ type: 'tool_result', toolUseId: 't', content: 'ok', isError: false }] })

describe('windowHeld', () => {
  it('changes nothing at or under the limit', () => {
    const held = run(HELD_MAX)
    expect(windowHeld(held, 7)).toEqual({ messages: held, cursor: 7 })
  })

  it('keeps the newest HELD_KEEP and points the cursor at the first one kept', () => {
    const out = windowHeld(run(HELD_MAX + 1), null)
    expect(out.messages).toHaveLength(HELD_KEEP)
    expect(out.messages[0].index).toBe(HELD_MAX + 1 - HELD_KEEP)
    expect(out.cursor).toBe(out.messages[0].index)
  })

  it('moves the cut later past a tool result whose call was dropped', () => {
    const held = run(HELD_MAX + 1)
    const cut = HELD_MAX + 1 - HELD_KEEP
    held[cut] = toolResult(cut)
    held[cut + 1] = toolResult(cut + 1)
    const out = windowHeld(held, null)
    expect(out.messages[0].index).toBe(cut + 2)
    expect(out.cursor).toBe(cut + 2)
  })

  it('does not cut at a message that has no line index', () => {
    const held = run(HELD_MAX + 1)
    const cut = HELD_MAX + 1 - HELD_KEEP
    held[cut] = { ...msg(cut), index: undefined }
    expect(windowHeld(held, null).messages[0].index).toBe(cut + 1)
  })
})

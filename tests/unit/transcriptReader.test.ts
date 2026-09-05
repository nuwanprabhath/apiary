import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  indexTranscript,
  readTranscriptPage,
  clearTranscriptCache,
} from '../../src/main/transcript/transcriptReader'

let dir: string
const file = () => join(dir, 's.jsonl')

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-tr-')); clearTranscriptCache() })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function write(lines: unknown[]): void {
  writeFileSync(file(), lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n') + '\n')
}

const userMsg = (uuid: string, text: string, extra = {}) => ({
  type: 'user', uuid, timestamp: '2026-09-01T10:00:00.000Z', isSidechain: false,
  message: { role: 'user', content: text }, ...extra,
})

const assistantMsg = (uuid: string, blocks: unknown[]) => ({
  type: 'assistant', uuid, timestamp: '2026-09-01T10:01:00.000Z', isSidechain: false,
  message: { role: 'assistant', content: blocks },
})

describe('indexTranscript', () => {
  it('counts only user and assistant lines', async () => {
    write([
      { type: 'queue-operation' },
      userMsg('u1', 'hi'),
      { type: 'ai-title', aiTitle: 'T' },
      assistantMsg('a1', [{ type: 'text', text: 'hello' }]),
    ])
    const { offsets, messageCount } = await indexTranscript(file())
    expect(offsets).toHaveLength(4)
    expect(offsets[0]).toBe(0)
    expect(messageCount).toBe(2)
  })
})

describe('readTranscriptPage', () => {
  it('returns user and assistant messages in file order', async () => {
    write([userMsg('u1', 'the export is empty'), assistantMsg('a1', [{ type: 'text', text: 'checking' }])])
    const page = await readTranscriptPage(file())
    expect(page.messages.map((m) => m.uuid)).toEqual(['u1', 'a1'])
    expect(page.messages[0].role).toBe('user')
    expect(page.messages[0].blocks).toEqual([{ type: 'text', text: 'the export is empty' }])
  })

  it('maps text, thinking and tool_use blocks', async () => {
    write([assistantMsg('a1', [
      { type: 'thinking', thinking: 'hmm' },
      { type: 'text', text: 'I will read the file' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x.ts' } },
    ])])
    const page = await readTranscriptPage(file())
    expect(page.messages[0].blocks).toEqual([
      { type: 'thinking', text: 'hmm' },
      { type: 'text', text: 'I will read the file' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/x.ts' } },
    ])
  })

  it('maps tool_result blocks including the error flag', async () => {
    write([{
      type: 'user', uuid: 'u1', timestamp: '2026-09-01T10:02:00.000Z', isSidechain: false,
      message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'file contents', is_error: false },
        { type: 'tool_result', tool_use_id: 't2', content: 'boom', is_error: true },
      ] },
    }])
    const page = await readTranscriptPage(file())
    expect(page.messages[0].blocks).toEqual([
      { type: 'tool_result', toolUseId: 't1', content: 'file contents', isError: false },
      { type: 'tool_result', toolUseId: 't2', content: 'boom', isError: true },
    ])
  })

  it('returns the newest messages and a cursor when the file exceeds the limit', async () => {
    write(Array.from({ length: 50 }, (_, i) => userMsg(`u${i}`, `msg ${i}`)))
    const page = await readTranscriptPage(file(), { limit: 10 })
    expect(page.messages).toHaveLength(10)
    expect(page.messages[0].uuid).toBe('u40')
    expect(page.messages[9].uuid).toBe('u49')
    expect(page.earlierCursor).not.toBeNull()
  })

  it('pages backwards to the start and then reports no cursor', async () => {
    write(Array.from({ length: 25 }, (_, i) => userMsg(`u${i}`, `msg ${i}`)))
    const first = await readTranscriptPage(file(), { limit: 10 })
    const second = await readTranscriptPage(file(), { limit: 10, beforeIndex: first.earlierCursor! })
    expect(second.messages.map((m) => m.uuid)).toEqual(
      ['u5','u6','u7','u8','u9','u10','u11','u12','u13','u14'],
    )
    const third = await readTranscriptPage(file(), { limit: 10, beforeIndex: second.earlierCursor! })
    expect(third.messages.map((m) => m.uuid)).toEqual(['u0','u1','u2','u3','u4'])
    expect(third.earlierCursor).toBeNull()
  })

  it('skips corrupt lines and reports how many', async () => {
    write([userMsg('u1', 'ok'), '{not json', assistantMsg('a1', [{ type: 'text', text: 'fine' }])])
    const page = await readTranscriptPage(file())
    expect(page.messages.map((m) => m.uuid)).toEqual(['u1', 'a1'])
    expect(page.skippedLines).toBe(1)
  })

  it('flags sidechain messages rather than dropping them', async () => {
    write([userMsg('u1', 'main'), userMsg('u2', 'sub', { isSidechain: true })])
    const page = await readTranscriptPage(file())
    expect(page.messages.map((m) => m.isSidechain)).toEqual([false, true])
  })

  it('returns an empty page for a file with no messages', async () => {
    write([{ type: 'queue-operation' }])
    const page = await readTranscriptPage(file())
    expect(page.messages).toHaveLength(0)
    expect(page.earlierCursor).toBeNull()
  })

  it('pages backward across non-message lines interleaved among messages without gaps or duplicates', async () => {
    // 24 messages (u0..u23) interleaved with 7 non-message lines
    // (queue-operation / ai-title), clustered so that each widened scan
    // window a small `limit` forces contains a mix of both. This is the
    // scenario the plan's window-relative `earlierCursor` formula got wrong:
    // non-message lines inside a scan window break any arithmetic that
    // assumes the window's line-index boundaries line up with message
    // positions.
    write([
      { type: 'queue-operation' },
      userMsg('u0', 'm0'),
      userMsg('u1', 'm1'),
      { type: 'ai-title', aiTitle: 'T' },
      userMsg('u2', 'm2'),
      userMsg('u3', 'm3'),
      userMsg('u4', 'm4'),
      { type: 'queue-operation' },
      userMsg('u5', 'm5'),
      userMsg('u6', 'm6'),
      userMsg('u7', 'm7'),
      userMsg('u8', 'm8'),
      { type: 'ai-title', aiTitle: 'T' },
      userMsg('u9', 'm9'),
      userMsg('u10', 'm10'),
      userMsg('u11', 'm11'),
      userMsg('u12', 'm12'),
      { type: 'queue-operation' },
      userMsg('u13', 'm13'),
      userMsg('u14', 'm14'),
      userMsg('u15', 'm15'),
      userMsg('u16', 'm16'),
      { type: 'ai-title', aiTitle: 'T' },
      userMsg('u17', 'm17'),
      userMsg('u18', 'm18'),
      userMsg('u19', 'm19'),
      userMsg('u20', 'm20'),
      { type: 'queue-operation' },
      userMsg('u21', 'm21'),
      userMsg('u22', 'm22'),
      userMsg('u23', 'm23'),
    ])

    const expectedUuids = Array.from({ length: 24 }, (_, i) => `u${i}`)

    const pages: string[][] = []
    let cursor: number | null | undefined = undefined
    let guard = 0
    for (;;) {
      const page = await readTranscriptPage(file(), { limit: 5, beforeIndex: cursor ?? undefined })
      pages.push(page.messages.map((m) => m.uuid))
      cursor = page.earlierCursor
      guard++
      if (cursor === null || guard > 20) break
    }

    // At least 2-3 pages of backward paging, as required by the finding.
    expect(pages.length).toBeGreaterThanOrEqual(3)

    // The last page reached must report no further cursor.
    expect(cursor).toBeNull()

    // Reassembling the pages oldest-first (pages arrive newest-first)
    // must reproduce every message exactly once, in file order: no
    // duplicates, no gaps.
    const reassembled = pages.slice().reverse().flat()
    expect(reassembled).toEqual(expectedUuids)
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { TranscriptReader } from '../../src/main/transcript/transcriptReader'

let dir: string
let reader: TranscriptReader
const file = () => join(dir, 's.jsonl')

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-tra-')); reader = new TranscriptReader() })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

const userMsg = (uuid: string) => ({
  type: 'user', uuid, timestamp: '2026-09-01T10:00:00.000Z', isSidechain: false, message: { role: 'user', content: uuid },
})
const write = (lines: unknown[]): void => {
  writeFileSync(file(), lines.map((l) => JSON.stringify(l)).join('\n') + '\n')
}
// Every third line is not a message, so a line index differs from a message position.
const mixed = (n: number): unknown[] =>
  Array.from({ length: n }, (_, i) => (i % 3 === 1 ? { type: 'ai-title' } : userMsg('u' + String(i))))

describe('line indexes and readTranscriptAfter', () => {
  it('stamps each message with its line index', async () => {
    write(mixed(5))
    const page = await reader.readTranscriptPage(file())
    expect(page.messages.map((m) => m.index)).toEqual([0, 2, 3])
  })

  it('answers only the messages after the index, with nothing earlier', async () => {
    write(mixed(6))
    const page = await reader.readTranscriptAfter(file(), 2)
    expect(page.messages.map((m) => m.index)).toEqual([3, 5])
    expect(page.earlierCursor).toBeNull()
  })

  it('answers nothing when the index is the last message', async () => {
    write(mixed(4))
    expect((await reader.readTranscriptAfter(file(), 3)).messages).toEqual([])
  })

  it('answers the newest page with a cursor when more than a page is newer', async () => {
    write(Array.from({ length: 450 }, (_, i) => userMsg('u' + String(i))))
    const page = await reader.readTranscriptAfter(file(), 9)
    expect(page.messages).toHaveLength(200)
    expect(page.messages.at(-1)?.index).toBe(449)
    expect(page.earlierCursor).toBe(250)
  })
})

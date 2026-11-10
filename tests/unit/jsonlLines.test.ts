import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { forEachLine, readExact } from '../../src/main/transcript/jsonlLines'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-jsonl-'))
  file = join(dir, 'session.jsonl')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

async function linesOf(
  options: Parameters<typeof forEachLine>[1],
): Promise<{ lines: string[]; nextOffset: number; skipped: number }> {
  const lines: string[] = []
  const result = await forEachLine(file, options, (line) => { lines.push(line) })
  return { lines, ...result }
}

describe('readExact', () => {
  it('continues a read that returns fewer bytes than asked', async () => {
    const source = Buffer.from('abcdefghij')
    const handle = {
      read: (buffer: Buffer, offset: number, length: number, position: number) => {
        const n = Math.min(3, length, Math.max(0, source.length - position))
        source.copy(buffer, offset, position, position + n)
        return Promise.resolve({ bytesRead: n, buffer })
      },
    }
    const buffer = Buffer.alloc(8)
    const read = await readExact(handle, buffer, 1)
    expect(read).toBe(8)
    expect(buffer.toString()).toBe('bcdefghi')
  })

  it('stops at end of file and says how much it read', async () => {
    writeFileSync(file, 'abc')
    const { open } = await import('node:fs/promises')
    const handle = await open(file, 'r')
    try {
      const buffer = Buffer.alloc(10)
      expect(await readExact(handle, buffer, 1)).toBe(2)
    } finally {
      await handle.close()
    }
  })
})

describe('forEachLine', () => {
  it('yields whole lines and returns the offset just past the last one', async () => {
    writeFileSync(file, 'one\ntwo\n')
    expect(await linesOf({ start: 0, maxLineBytes: 100 })).toEqual({ lines: ['one', 'two'], nextOffset: 8, skipped: 0 })
  })

  it('does not yield a partial last line and stops before it', async () => {
    writeFileSync(file, 'one\ntw')
    expect(await linesOf({ start: 0, maxLineBytes: 100 })).toEqual({ lines: ['one'], nextOffset: 4, skipped: 0 })
  })

  it('skips and counts a line longer than maxLineBytes, across chunks', async () => {
    writeFileSync(file, `a\n${'x'.repeat(50)}\nb\n`)
    const result = await linesOf({ start: 0, maxLineBytes: 10, chunkBytes: 4 })
    expect(result).toEqual({ lines: ['a', 'b'], nextOffset: 55, skipped: 1 })
  })

  it('decodes a multi-byte character split across two chunks', async () => {
    writeFileSync(file, 'é€😀\nok\n')
    for (const chunkBytes of [1, 2, 3, 5]) {
      expect((await linesOf({ start: 0, maxLineBytes: 100, chunkBytes })).lines).toEqual(['é€😀', 'ok'])
    }
  })

  it('reads from start to end only', async () => {
    writeFileSync(file, 'one\ntwo\nthree\n')
    expect(await linesOf({ start: 4, end: 8, maxLineBytes: 100 })).toEqual({ lines: ['two'], nextOffset: 8, skipped: 0 })
  })

  it('skips empty lines without yielding them', async () => {
    writeFileSync(file, '\none\n\n')
    expect(await linesOf({ start: 0, maxLineBytes: 100 })).toEqual({ lines: ['one'], nextOffset: 6, skipped: 0 })
  })
})

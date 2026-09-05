import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readHeadLines, readTailLines } from '../../src/main/scanner/boundaryRead'

let dir: string
const file = () => join(dir, 'sample.jsonl')

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('readHeadLines', () => {
  it('returns every line when the file is smaller than the chunk', async () => {
    writeFileSync(file(), 'a\nb\nc\n')
    expect(await readHeadLines(file())).toEqual(['a', 'b', 'c'])
  })

  it('drops the trailing partial line when the chunk cuts mid-line', async () => {
    writeFileSync(file(), 'aaaa\nbbbb\ncccc\n')
    // 7 bytes covers "aaaa\nbb" — only "aaaa" is complete.
    expect(await readHeadLines(file(), 7)).toEqual(['aaaa'])
  })

  it('returns an empty array when no complete line fits', async () => {
    writeFileSync(file(), 'aaaaaaaaaa\n')
    expect(await readHeadLines(file(), 4)).toEqual([])
  })
})

describe('readTailLines', () => {
  it('returns every line in file order when the file is small', async () => {
    writeFileSync(file(), 'a\nb\nc\n')
    expect(await readTailLines(file())).toEqual(['a', 'b', 'c'])
  })

  it('drops the leading partial line when the chunk cuts mid-line', async () => {
    writeFileSync(file(), 'aaaa\nbbbb\ncccc\n')
    // Last 8 bytes are "b\ncccc\n" plus one byte of "bbbb" — only "cccc" is complete.
    expect(await readTailLines(file(), 8)).toEqual(['cccc'])
  })

  it('handles a file with no trailing newline', async () => {
    writeFileSync(file(), 'aaaa\nbbbb')
    expect(await readTailLines(file())).toEqual(['aaaa', 'bbbb'])
  })

  it('returns an empty array for an empty file', async () => {
    writeFileSync(file(), '')
    expect(await readTailLines(file())).toEqual([])
  })
})

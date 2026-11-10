import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// A "png" here is a text file of one digit per pixel: the pure part needs no image library.
interface Fake {
  pixels: string
}
const options = {
  readPng: (path: string): Fake & { width: number; height: number } => {
    const pixels = readFileSync(path, 'utf8')
    return { width: pixels.length, height: 1, pixels }
  },
  countDiff: (a: Fake, b: Fake): number => [...a.pixels].filter((c, i) => c !== b.pixels[i]).length,
}

interface Report {
  added: string[]
  removed: string[]
  changed: { file: string; ratio: number }[]
}
interface UiDiff {
  compareShots: (before: string, after: string, io: typeof options) => Report
  summaryMarkdown: (r: Report) => string
}
// The script is plain JS with no declaration file, so its shape is stated here.
const scriptPath = '../../scripts/ui-diff.mjs'
const { compareShots, summaryMarkdown } = (await import(/* @vite-ignore */ scriptPath)) as UiDiff

describe('compareShots', () => {
  let root: string
  let before: string
  let after: string
  const put = (dir: string, name: string, px: string) => writeFileSync(join(dir, name), px)
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'uidiff-'))
    before = join(root, 'before')
    after = join(root, 'after')
    mkdirSync(before)
    mkdirSync(after)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('lists added, removed and changed files with the changed ratio', () => {
    put(before, 'same.png', '0000')
    put(after, 'same.png', '0000')
    put(before, 'gone.png', '0000')
    put(after, 'new.png', '0000')
    put(before, 'moved.png', '0000')
    put(after, 'moved.png', '0011')
    const r = compareShots(before, after, options)
    expect(r.added).toEqual(['new.png'])
    expect(r.removed).toEqual(['gone.png'])
    expect(r.changed).toEqual([{ file: 'moved.png', ratio: 0.5 }])
  })

  it('ignores a difference under 0.1%', () => {
    const base = '0'.repeat(2000)
    put(before, 'a.png', base)
    put(after, 'a.png', '1' + base.slice(1)) // 0.05%
    put(before, 'b.png', base)
    put(after, 'b.png', '11' + base.slice(2)) // 0.1%
    const r = compareShots(before, after, options)
    expect(r.changed.map((c) => c.file)).toEqual(['b.png'])
  })

  it('counts a size change as fully changed', () => {
    put(before, 'a.png', '000')
    put(after, 'a.png', '0000')
    expect(compareShots(before, after, options).changed).toEqual([{ file: 'a.png', ratio: 1 }])
  })

  it('writes an empty-list summary when nothing changed', () => {
    expect(summaryMarkdown({ added: [], removed: [], changed: [] })).toContain('No visual change')
  })
})

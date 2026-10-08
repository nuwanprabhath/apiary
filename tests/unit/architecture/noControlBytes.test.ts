import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROOT, judge, loadAllow, staleReport, walk } from './allowlist'

/**
 * Prevents: a raw control byte (NUL, ESC, BEL...) pasted into a source file. `registry.ts:147`
 * holds a literal NUL as a key separator — invisible in review, it makes git treat the file as
 * binary (no diff, no blame), breaks grep, and survives copy-paste into places that truncate at
 * NUL. A separator that is needed is written as an escape (`'\0'`, `'\x1b'`), which says what it
 * is and keeps the file text.
 *
 * Only tab, LF and CR may appear raw. `tests/fixtures/` is skipped because it holds captured
 * terminal output (ESC and BEL sequences are the point of those files), and only text source
 * extensions are scanned, so images and fonts are never opened.
 *
 * Allowlist: noControlBytes.allow.json, keyed `path` (one entry per file). It only shrinks: an
 * entry whose file no longer holds a control byte fails the test, so delete it with the fix.
 */
const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.mts', '.css', '.json', '.md', '.html', '.sh']
const DIRS = ['src', 'tests', 'scripts', 'eslint']

function firstControl(buf: Buffer): { line: number, byte: number } | null {
  let line = 1
  for (const b of buf) {
    if (b === 0x0a) line += 1
    else if (b < 0x20 && b !== 0x09 && b !== 0x0d) return { line, byte: b }
  }
  return null
}

describe('no raw control bytes in source files', () => {
  const allow = loadAllow('noControlBytes.allow.json')
  const hits = new Map<string, string>()
  for (const rel of walk(DIRS, EXTS, (p) => p.startsWith('tests/fixtures'))) {
    const hit = firstControl(readFileSync(join(ROOT, rel)))
    if (hit) hits.set(rel, `${rel}:${hit.line} has a raw 0x${hit.byte.toString(16).padStart(2, '0')} byte`)
  }
  const verdict = judge(hits.keys(), allow)

  it('has no file with a NUL, ESC or other C0 byte beyond tab/LF/CR', () => {
    expect(
      verdict.unlisted.map((k) => `${hits.get(k)} — write it as an escape ('\\0', '\\x1b'), not the raw byte`),
    ).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('noControlBytes.allow.json', verdict.stale)).toEqual([])
  })
})

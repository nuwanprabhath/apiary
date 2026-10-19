import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { read, walk } from './allowlist'

/**
 * Prevents: history in a source comment. Every agent that opens a file reads its comments, and by
 * 1.44 there were 267 citing an Apiary version ("since 1.35.0", "until 1.44") or a review id
 * (MAIN-6, UI-14, SEC-7, §7.2). That is the changelog's and git's job; what a comment keeps is the
 * fact that still holds. The judgment part (narration, apologies, duplicates) is the trim-comments
 * skill (`.claude/skills/trim-comments/`); this is the part a pattern can decide.
 *
 * Only Apiary's own versions count: a version of something we depend on ("claude 2.1.286",
 * "Electron 44") is a fact about that dependency. No allowlist: a comment that needs a version to
 * make sense says what changed instead.
 */
const DIRS = ['src', 'scripts', 'eslint']
const EXTS = ['.ts', '.tsx', '.mjs', '.js', '.cjs']
// Apiary's minor has two digits (1.10 onwards); "1.0.12" and "v1.9.0" in a comment are example
// branch and tag names, and "at 1.25" is a multiplier.
const APIARY_VERSION = /\bv?1\.\d{2}\.\d+\b|\b(?:since|until|in|before|after|from)\s+1\.\d{2}\b/i
const REVIEW_ID = /\b(?:MAIN|UI|SEC|PERF|ARCH)-\d+\b|§\d/

/** Every comment in the file, found through the parse tree: a bare scanner loses its place after a
 *  template literal and skips the comments that follow it. */
function comments(rel: string): { line: number; text: string }[] {
  const text = read(rel)
  const kind = rel.endsWith('x') ? ts.ScriptKind.TSX : rel.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS
  const file = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind)
  const seen = new Map<number, string>()
  const collect = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const r of ranges ?? []) seen.set(r.pos, text.slice(r.pos, r.end))
  }
  const visit = (node: ts.Node): void => {
    collect(ts.getLeadingCommentRanges(text, node.getFullStart()))
    collect(ts.getTrailingCommentRanges(text, node.getEnd()))
    for (const child of node.getChildren(file)) visit(child)
  }
  visit(file)
  return [...seen].map(([pos, body]) => ({ line: file.getLineAndCharacterOfPosition(pos).line + 1, text: body }))
}

describe('source comments carry facts, not history', () => {
  it('cites no Apiary version and no review id', () => {
    const hits: string[] = []
    for (const rel of walk(DIRS, EXTS)) {
      // A comment can only match where the file's text does, so most files are never parsed: parsing
      // all of them took this past the 5 s test timeout on CI's two-core runner under coverage.
      const text = read(rel)
      if (!APIARY_VERSION.test(text) && !REVIEW_ID.test(text)) continue
      for (const c of comments(rel)) {
        const m = APIARY_VERSION.exec(c.text) ?? REVIEW_ID.exec(c.text)
        if (m) hits.push(`${rel}:${String(c.line)} cites "${m[0]}"`)
      }
    }
    expect(
      hits.map((h) => `${h} — history belongs in CHANGELOG.md and git; keep only the fact that still holds (trim-comments skill)`),
    ).toEqual([])
  })
})

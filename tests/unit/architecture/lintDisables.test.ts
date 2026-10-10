import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Prevents: switching a check off to get past it. Every `eslint-disable` / `stylelint-disable` in
 * the repo is listed in `lintDisables.allow.json` (file → how many), so a new one fails here and
 * shows up in review as an edit to that file. A 1.35.0 agent disabled `prefer-const` with a reason
 * saying main would later set the variable; nothing ever did. The reason read well and was false. `reportUnusedDisableDirectives` only
 * notices a disable that stopped applying, and `require-description` only that a reason exists.
 *
 * Fix the code instead. A genuine exception (a rule that is wrong for this one line) is added to the
 * allowlist in the same commit, where a reviewer sees it. A count that drops must be lowered here
 * (the list only shrinks unless a reviewer agrees).
 */
const ROOT = join(__dirname, '../../..')
const ALLOW = join(__dirname, 'lintDisables.allow.json')
const DIRS = ['src', 'tests', 'eslint', 'scripts']
const DISABLE = /\b(eslint|stylelint)-disable(-next-line|-line)?\b/g

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full, out); continue }
    if (/\.(ts|tsx|js|mjs|cjs|css)$/.test(name) && full !== __filename) out.push(full)
  }
}

describe('lint disables are reviewed, not added in passing', () => {
  const files: string[] = []
  for (const d of DIRS) walk(join(ROOT, d), files)
  const counts: Record<string, number> = {}
  for (const f of files) {
    const n = (readFileSync(f, 'utf8').match(DISABLE) ?? []).length
    if (n > 0) counts[relative(ROOT, f).split('\\').join('/')] = n
  }
  const allowed = JSON.parse(readFileSync(ALLOW, 'utf8')) as Record<string, number>

  it('adds no disable the allowlist does not hold', () => {
    const grown = Object.entries(counts)
      .filter(([f, n]) => n > (allowed[f] ?? 0))
      .map(([f, n]) => `${f}: ${String(n)} disable(s), ${String(allowed[f] ?? 0)} reviewed — fix the code the check flagged instead of switching the check off`)
    expect(grown).toEqual([])
  })

  it('has no stale allowlist entry (lower the count when a disable goes)', () => {
    const stale = Object.entries(allowed)
      .filter(([f, n]) => (counts[f] ?? 0) < n)
      .map(([f, n]) => `${f}: allowlist says ${String(n)}, file has ${String(counts[f] ?? 0)}`)
    expect(stale).toEqual([])
  })
})

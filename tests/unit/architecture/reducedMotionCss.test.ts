import { describe, it, expect } from 'vitest'
import { read, walk } from './allowlist'

/**
 * Prevents: an animation that never ends in the app's chrome, with no still counterpart. Without
 * the GPU Chromium recomposites the whole window on every animation frame, so each `infinite`
 * animation costs typing speed while an agent works (docs/perf/2026-10-17-load-benchmark.md).
 * `<html data-motion="reduced">` is set when the person chose Reduced, the system asks for less
 * motion, or Apiary draws without the GPU (`state/motion.ts`).
 *
 * Every selector with an `infinite` animation needs a rule `:root[data-motion="reduced"] <selector>`
 * in the stylesheets that sets `animation: none` (and a still cue, such as the three-quarter ring of
 * `.status-dot`). Do not write a `@media (prefers-reduced-motion)` copy: Automatic already maps the
 * media query to `data-motion`.
 *
 * Pets (`70-pets.css`) are exempt: they are opt-in, and drawn flat, without WebGL, on such machines.
 */
const EXEMPT_FILES = new Set(['src/renderer/styles/70-pets.css'])
const REDUCED = ':root[data-motion="reduced"]'

interface Rule { selector: string, body: string }

const strip = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Style rules, flattened through `@media`/`@supports`; `@keyframes` bodies are skipped. */
function rulesOf(css: string): Rule[] {
  const out: Rule[] = []
  const walkBlock = (text: string): void => {
    let i = 0
    while (i < text.length) {
      const open = text.indexOf('{', i)
      if (open < 0) break
      const head = text.slice(i, open).trim()
      let depth = 1
      let j = open + 1
      while (depth > 0 && j < text.length) { const c = text[j++]; if (c === '{') depth++; else if (c === '}') depth-- }
      const body = text.slice(open + 1, j - 1)
      if (head.startsWith('@keyframes') || head.startsWith('@font-face')) { /* no selectors */ }
      else if (head.startsWith('@')) walkBlock(body)
      else out.push({ selector: head, body })
      i = j
    }
  }
  walkBlock(strip(css))
  return out
}

const selectorsOf = (rule: Rule): string[] => rule.selector.split(/,(?![^(]*\))/).map((s) => s.replace(/\s+/g, ' ').trim())
const animationDeclarations = (body: string): string[] => [...body.matchAll(/(?:^|[;\s])animation(?:-name)?\s*:\s*([^;}]+)/g)].map((m) => m[1])

describe('every infinite animation has a still counterpart under data-motion="reduced"', () => {
  const files = walk(['src/renderer/styles'], ['.css']).filter((f) => !EXEMPT_FILES.has(f))
  const rules = files.flatMap((f) => rulesOf(read(f)).map((r) => ({ ...r, file: f })))

  const stilled = new Set(
    rules
      .filter((r) => animationDeclarations(r.body).some((v) => /^none\b/.test(v.trim())))
      .flatMap((r) => selectorsOf(r))
      .filter((s) => s.startsWith(REDUCED))
      .map((s) => s.slice(REDUCED.length).trim()),
  )

  const moving = rules
    .filter((r) => !r.selector.startsWith(REDUCED) && animationDeclarations(r.body).some((v) => /\binfinite\b/.test(v)))
    .flatMap((r) => selectorsOf(r).map((s) => `${r.file}: ${s}`))

  it('finds the animations it guards', () => {
    expect(moving.length).toBeGreaterThan(5)
  })

  it('has a reduced rule for each', () => {
    const missing = moving.filter((m) => !stilled.has(m.slice(m.indexOf(': ') + 2)))
    const fix = `These selectors animate forever with no \`${REDUCED} <selector> { animation: none; … }\` rule. ` +
      'Add one beside the animation (keep a still cue: a ring, a halo, a colour) — it applies when the person ' +
      'chose Reduced, the system asks for less motion, or Apiary draws without the GPU (state/motion.ts).'
    expect(missing.length === 0 ? [] : [fix, ...missing]).toEqual([])
  })
})

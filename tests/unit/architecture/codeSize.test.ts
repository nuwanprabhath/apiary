import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROOT, judge, loadAllow, staleReport, walk } from './allowlist'

/**
 * Rule: a source file under `max-lines` holds at most `CODE_MAX` characters of code (comments
 * dropped, each run of whitespace counted as one), however its lines are broken.
 *
 * Why: `max-lines` counts lines, so a file at 400 can be "fixed" by joining statements with `;`,
 * declaring two consts on one line, or folding a method body into one `if`. Agents did exactly that
 * in the privacy release (`container.ts`, `residentService.ts`, `index.ts`, `contract.ts`'s
 * imports), and every squeeze kept the lint green. Joining lines never removes characters, so this
 * budget stays where it was: the way under it is splitting by responsibility.
 *
 * `CODE_MAX` is 400 lines at the codebase's mean of 40 characters of code per line. Measured over
 * `src/`: honest files top out near 15,300; the squeezed ones were 17,300 to 20,400.
 *
 * Exempt like `max-lines` itself (`eslint.config.js`, the size-budget block): the pets' drawing and
 * brain data. An allowlisted file is a declaration table (one entry per line, long by nature): it
 * is held to `TABLE_MAX` instead, so it cannot take a squeeze either.
 */
const CODE_MAX = 16_000
const TABLE_MAX = 32_000
const ALLOW = 'codeSize.allow.json'
const EXEMPT = [/^src\/renderer\/features\/pets\/parts\.tsx$/, /^src\/renderer\/features\/pets\/render3d\//, /^src\/shared\/pets\/brain\.ts$/]

export function codeChars(text: string): number {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('//'))
    .reduce((sum, line) => sum + line.replace(/\s+/g, ' ').length, 0)
}

function sizes(): Map<string, number> {
  const out = new Map<string, number>()
  for (const file of walk(['src'], ['.ts', '.tsx'])) {
    const rel = relative(ROOT, file).split('\\').join('/')
    if (EXEMPT.some((re) => re.test(rel))) continue
    out.set(rel, codeChars(readFileSync(join(ROOT, rel), 'utf8')))
  }
  return out
}

describe('code size', () => {
  it('measures code, not line breaks: joining statements onto one line saves nothing', () => {
    const spread = 'const a = 1\nconst b = 2\nif (a) {\n  run()\n}\n'
    const squeezed = 'const a = 1, b = 2; if (a) { run() }\n'
    expect(codeChars(squeezed)).toBeGreaterThanOrEqual(codeChars(spread) - 6)
    expect(codeChars('/** doc */\n// note\nconst a = 1\n')).toBe('const a = 1'.length)
  })

  it(`keeps every src file under ${String(CODE_MAX)} characters of code`, () => {
    const allow = loadAllow(ALLOW)
    const all = sizes()
    const over = [...all].filter(([, n]) => n > CODE_MAX).map(([f]) => f)
    const { unlisted, stale } = judge(over, allow)
    const tables = allow.map((a) => a.key).filter((k) => (all.get(k) ?? 0) > TABLE_MAX)
    expect([
      ...unlisted.map((f) => `${f}: ${String(all.get(f))} characters of code (max ${String(CODE_MAX)}). Split it by responsibility (a subsystem's own module, as app/*Container.ts and residents/residentCycle do); joining lines does not lower this count.`),
      ...tables.map((f) => `${f}: ${String(all.get(f))} characters, over the table ceiling ${String(TABLE_MAX)}. Split the table by area.`),
      ...staleReport(ALLOW, stale),
    ]).toEqual([])
  })
})

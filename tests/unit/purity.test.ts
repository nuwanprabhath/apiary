import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The unit/integration split (TEST-2) only means something if nothing in tests/unit can drift
 * back into driving a real subprocess or a native module — that is exactly the contention
 * vitest.config.ts's integration project runs serially to avoid. A text grep over each file is
 * enough: it is cheap, and it catches the import regardless of how the module is used.
 *
 * Two things do not count as drifting back in, and are excluded line by line before matching:
 * - a `import type { ... } from '<module>'` — types only, nothing runs at import time;
 * - a module `vi.mock()` replaces outright — the whole point of a mock is that the real module
 *   (and whatever it would have spawned or loaded) never executes.
 */
const FORBIDDEN = [
  'better-sqlite3',
  'node-pty',
  'node:child_process',
  "from 'child_process'",
  '/appService',
  '/ptyManager',
]

function isMocked(text: string, needle: string): boolean {
  return text.includes(`vi.mock('${needle}'`) || text.includes(`vi.mock("${needle}"`)
}

describe('tests/unit stays native- and subprocess-free', () => {
  const dir = __dirname
  const files = readdirSync(dir).filter((f) => f.endsWith('.test.ts') && f !== 'purity.test.ts')

  for (const file of files) {
    it(`${file} does not import a native module or a subprocess-driving class`, () => {
      const text = readFileSync(join(dir, file), 'utf8')
      const runtimeLines = text.split('\n').filter((line) => !/^\s*import type /.test(line)).join('\n')
      for (const needle of FORBIDDEN) {
        if (isMocked(text, needle)) continue
        expect(runtimeLines.includes(needle), `${file} imports "${needle}"`).toBe(false)
      }
    })
  }
})

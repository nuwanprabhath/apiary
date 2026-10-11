import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(import.meta.dirname, '../../..')

/** How many violations a baseline file still grandfathers (missing file: none). */
function size(file: string): number {
  const path = join(ROOT, file)
  if (!existsSync(path)) return 0
  const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (Array.isArray(data)) return data.length
  if (data === null || typeof data !== 'object') return 0
  let n = 0
  for (const rules of Object.values(data)) {
    for (const entry of Object.values(rules as Record<string, unknown>)) {
      n += typeof entry === 'object' && entry !== null && 'count' in entry ? Number(entry.count) : 1
    }
  }
  return n
}

// The 1.34.0 guardrails grandfathered 311 lint violations, 51 layer violations and 91 unused exports
// into shrink-only baselines, and in the three releases after it not one entry was fixed: "fix it
// when you touch it" was never enforced. They were emptied in the 1.38 cleanup; a new entry now fails
// here, so grandfathering is a decision someone makes in this file, never a side effect of a script.
describe('the lint baselines grandfather nothing', () => {
  it.each([
    ['eslint-suppressions.json', 'npm run lint:prune after fixing; never `eslint --suppress-*`'],
    ['stylelint-suppressions.json', 'fix the declaration; never `stylelint --suppress`'],
    ['.dependency-cruiser-known-violations.json', 'fix the import; never `npm run lint:arch:baseline` to hide one'],
    ['.knip-baseline.json', 'delete or use the export; never `npm run lint:dead:baseline` to hide one'],
  ])('%s is empty', (file, how) => {
    expect(size(file), `${file} grandfathers violations: fix them instead (${how}). A new rule the maintainer adopts with existing violations is baselined here on purpose, by changing this test, with the plan to empty it.`).toBe(0)
  })
})

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import budget from '../../e2e/budget.json'

/**
 * The e2e suite is the slowest layer by far (each test launches the app), and it only grew: every
 * fix added a test and nothing took one away. Its size is a budget, counted here from the specs the
 * default run picks up (`live/` and `bench/` are opt-in and spend no budget).
 *
 * Over budget: move a test that only drives the renderer down to a component test, merge or remove
 * one (the `prune-tests` skill finds candidates), or have the maintainer raise the budget in the
 * same commit with the reason. Under it: lower the budget, so the room is not spent by accident.
 */
const E2E = join(import.meta.dirname, '..', '..', 'e2e')
const OPT_IN = new Set(['live', 'bench'])
const TEST = /^\s*test(?:\.(?:skip|fixme|only))?\(\s*['"`]/gm

function specs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return OPT_IN.has(e.name) ? [] : specs(join(dir, e.name))
    return e.name.endsWith('.spec.ts') ? [join(dir, e.name)] : []
  })
}

describe('the e2e budget', () => {
  const count = specs(E2E).reduce((n, f) => n + (readFileSync(f, 'utf8').match(TEST)?.length ?? 0), 0)

  it('the default e2e run has no more tests than tests/e2e/budget.json allows', () => {
    expect(count, `${String(count)} e2e tests, budget ${String(budget.tests)}. Move a renderer-only test to tests/component, merge or remove one (.claude/skills/prune-tests/SKILL.md); raising the budget is the maintainer's call, with the reason in the commit.`).toBeLessThanOrEqual(budget.tests)
  })

  it('the budget is not left with room to spare', () => {
    expect(budget.tests - count, `${String(count)} e2e tests, budget ${String(budget.tests)}: lower tests/e2e/budget.json to ${String(count)}.`).toBeLessThanOrEqual(0)
  })
})

import { describe, it, expect } from 'vitest'
import { IPC } from '@shared/ipc/contract'
import { isLooseGuard } from '@shared/ipc/guards'
import { judge, loadAllow, staleReport } from './allowlist'

/**
 * Prevents: a channel whose runtime guard proves less than its declared argument type (the
 * `petUpdate`/`petVoice` pattern: `tuple(str, obj)` for a `PetPatch`, then a handler cast to hide
 * it). `invoke`/`send` take a `Guard<A>` for the declared `A`, so the compiler catches most of
 * them — but an object guard also satisfies an all-optional type, and `any` is `unknown`, so
 * `obj` and `any` are marked loose (`shared/ipc/guards.ts`) and this test holds the contract to
 * two rules:
 *
 * 1. A channel whose guard uses `obj`/`any` is declared with `invokeLoose`/`sendLoose`, and one
 *    declared that way really uses one (so a loose declaration cannot linger after its guard was
 *    made real).
 * 2. The set of loose channels is the allowlist in looseGuards.allow.json, each entry naming the
 *    validator that actually checks the value. It only shrinks.
 */
describe('loosely guarded IPC channels', () => {
  const specs = Object.entries(IPC).flatMap(([key, spec]) =>
    spec.kind === 'invoke' || spec.kind === 'send' ? [{ key, spec }] : [])

  it('declares a channel loose exactly when its guard is `obj` or `any`', () => {
    const mismatched = specs
      .filter(({ spec }) => isLooseGuard(spec.args) !== (spec.loose === true))
      .map(({ key, spec }) => (spec.loose === true
        ? `${key} is declared with invokeLoose/sendLoose but its guard is strict — declare it with invoke/send`
        : `${key} uses obj/any in its guard — write a real guard, or declare it with invokeLoose/sendLoose and name its validator`))
    expect(mismatched).toEqual([])
  })

  it('has exactly the allowlisted loose channels', () => {
    const allow = loadAllow('looseGuards.allow.json')
    const verdict = judge(specs.filter(({ spec }) => spec.loose === true).map(({ key }) => key), allow)
    expect([
      ...verdict.unlisted.map((k) => `${k} is loose but not in looseGuards.allow.json`),
      ...staleReport('looseGuards.allow.json', verdict.stale),
    ]).toEqual([])
  })
})

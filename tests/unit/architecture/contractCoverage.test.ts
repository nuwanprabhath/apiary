import { describe, it, expect } from 'vitest'
import { judge, loadAllow, read, staleReport, walk } from './allowlist'

/**
 * Prevents: an IPC channel the fake `window.apiary` can drift on unnoticed (review TEST-5). Every
 * component test renders against `tests/component/fakeApiary.ts`; the only thing that keeps that
 * fake honest is `tests/contract/bridgeContract.ts`, one spec run against both the fake and the
 * real preload + main handlers. A channel with no clause there can behave one way in the fake and
 * another in main with every test green — chat, pets, update, theme, tabs and branch changes
 * were all in that state.
 *
 * Rule: every key of `IPC` in src/shared/ipc/contract.ts has at least one clause, in a file under
 * tests/contract/, that exercises it — an `invoke`/`send` channel by calling the method of its key
 * (`api.petDelete(`), an `event` channel by asserting on what was heard (`heard.count('treeChanged')`,
 * `heard.payloads('treeChanged')`), and the one `sync` channel by reading the property it becomes.
 * Matching is by text with comments removed, which is deliberately crude: it proves the channel is
 * exercised somewhere, not that it is exercised well.
 *
 * Allowlist: contractCoverage.allow.json, keyed by IPC key. It only shrinks: a channel that gains
 * a contract clause must be deleted from it, or this test fails. What is left in it is exempt for a
 * stated reason (it cannot run in the loopback), never for want of a clause: a `debt` entry is
 * refused outright (the B19 backlog is cleared), and so is an exemption for an event the fake
 * emits, because a fake that emits an event is modelling main and that model needs a clause to pin it.
 */
const SYNC_PROPERTY: Record<string, string> = { themeInitial: 'initialTheme' }

interface Channel { key: string, kind: string, method: string }

function channels(): Channel[] {
  const src = read('src/shared/ipc/contract.ts')
  const body = src.slice(src.indexOf('export const IPC = {'), src.indexOf('} as const'))
  return [...body.matchAll(/^ {2}(\w+): (invoke|invokeLoose|send|sendLoose|event|sync|local)\b/gm)].map((m) => {
    const [, key, rawKind] = m
    const kind = rawKind.replace('Loose', '')
    return { key, kind, method: kind === 'sync' ? SYNC_PROPERTY[key] : key }
  })
}

/** Every clause file, without its comments (a name in a comment exercises nothing). */
function clauseText(): string {
  return walk(['tests/contract'], ['.ts'])
    .map((rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1'))
    .join('\n')
}

/** The text a clause must contain to exercise `c`. */
function exercised(c: Channel, spec: string): boolean {
  if (!c.method) return false
  if (c.kind === 'event') return new RegExp(`heard\\.(count|payloads)\\(\\s*'${c.key}'`).test(spec)
  if (c.kind === 'sync') return new RegExp(`\\.${c.method}\\b`).test(spec)
  return new RegExp(`\\.${c.method}\\(`).test(spec)
}

describe('every IPC channel has a clause in the bridge contract', () => {
  const all = channels()
  const spec = clauseText()
  const allow = loadAllow('contractCoverage.allow.json')
  const uncovered = all.filter((c) => !exercised(c, spec))
  const verdict = judge(uncovered.map((c) => c.key), allow)

  it('finds the channels (the scan itself is not silently empty)', () => {
    expect(all.length).toBeGreaterThan(100)
    expect(all.filter((c) => c.kind === 'sync').every((c) => c.method)).toBe(true)
  })

  it('covers each channel, or lists it in contractCoverage.allow.json with a reason', () => {
    const byKey = new Map(all.map((c) => [c.key, c]))
    expect(verdict.unlisted.map((k) => {
      const c = byKey.get(k)
      return c?.method
        ? `${c.kind} channel "${k}": no clause under tests/contract/ ${c.kind === 'event' ? `asserts on \`heard.count('${k}')\` or \`heard.payloads('${k}')\`` : `calls \`${c.method}\``} — add one (it runs against the fake and real main), or add the key to contractCoverage.allow.json with the reason it cannot run in the loopback`
        : `sync channel "${k}": add its window.apiary property name to SYNC_PROPERTY in contractCoverage.test.ts`
    })).toEqual([])
  })

  it('has no debt: a channel is either exercised or exempt for a reason that stays true', () => {
    expect(allow.filter((e) => e.debt === true).map((e) => e.key)).toEqual([])
  })

  it('does not exempt an event the fake emits', () => {
    const fakeSources = ['tests/component/fakeApiary.ts', ...walk(['tests/component/fake'], ['.ts'])]
    const emitted = new Set(fakeSources.flatMap((rel) => [...read(rel).matchAll(/\bemit\('(\w+)'/g)].map((m) => m[1])))
    expect(emitted.size).toBeGreaterThan(5)
    expect(
      allow.filter((e) => emitted.has(e.key)).map((e) => `${e.key}: the fake emits it, so main's behaviour for it is modelled — add a clause that asserts on it (heard.count('${e.key}')) and delete this exemption`),
    ).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('contractCoverage.allow.json', verdict.stale)).toEqual([])
  })
})

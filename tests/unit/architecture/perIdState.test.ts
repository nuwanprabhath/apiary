import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { judge, loadAllow, read, staleReport, walk } from './allowlist'

/**
 * Prevents: per-id state kept in parallel maps (MAIN-6). `PtyManager` held nine `Map<string, …>`
 * fields keyed by the same pty id — process, size, cwd, tui flags, output counters, screen — and
 * each cleanup path had to remember all of them. One path did not, and a killed child's late
 * `onExit` deleted the entries a respawned pty with the same id had just written, so a live
 * terminal went dark. One record per id (`PtyEntry`) is replaced or dropped as a unit, and the
 * identity of its process is checked before a callback acts on it.
 *
 * Rule: a class under `src/main` has at most two fields initialised with `new Map<string, …>()`
 * (a cache plus its in-flight twin is fine). A third means the fields describe one thing: make a
 * single record type and keep one `Map<string, Record>`, so spawn, kill and exit each touch one
 * place.
 *
 * Allowlist: perIdState.allow.json, keyed `<file>#<Class>`, with a reason. It only shrinks.
 */
const MAX_STRING_KEYED_MAPS = 2

/** `new Map<string, …>()` with a first type argument of `string`, the shape of a per-id table. */
function isStringKeyedMap(init: ts.Expression | undefined): boolean {
  if (init === undefined || !ts.isNewExpression(init)) return false
  if (!ts.isIdentifier(init.expression) || init.expression.text !== 'Map') return false
  return init.typeArguments?.[0]?.kind === ts.SyntaxKind.StringKeyword
}

/** `<file>#<Class>` of each class with more string-keyed Map fields than the limit. */
function violations(file: string, source: string): { classes: number, bad: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  let classes = 0
  const bad: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node) && node.name !== undefined) {
      classes += 1
      const maps = node.members.filter((m) => ts.isPropertyDeclaration(m) && isStringKeyedMap(m.initializer))
      if (maps.length > MAX_STRING_KEYED_MAPS) bad.push(`${file}#${node.name.text}`)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { classes, bad }
}

describe('per-id state lives in one record', () => {
  const files = walk(['src/main'], ['.ts'])
  const results = files.map((f) => violations(f, read(f)))
  const allow = loadAllow('perIdState.allow.json')
  const verdict = judge(results.flatMap((r) => r.bad), allow)

  it('scans the main process classes (the scan itself is not silently empty)', () => {
    expect(results.reduce((n, r) => n + r.classes, 0)).toBeGreaterThan(30)
  })

  it('keeps at most two string-keyed Maps per class, or lists the class in perIdState.allow.json with a reason', () => {
    expect(verdict.unlisted.map((k) => `${k}: three or more Map<string, …> fields describe one thing; use one record type and a single Map<string, Record> (see PtyEntry in src/main/pty/ptyManager.ts)`)).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('perIdState.allow.json', verdict.stale)).toEqual([])
  })

  describe('the check itself', () => {
    const maps = (n: number): string =>
      `class C { ${Array.from({ length: n }, (_, i) => `private m${String(i)} = new Map<string, number>()`).join('\n')} }`

    it('accepts two string-keyed maps and any number of other fields', () => {
      expect(violations('a.ts', maps(2)).bad).toEqual([])
      expect(violations('a.ts', 'class C { a = new Map<number, number>(); b = new Map<number, number>(); c = new Map<number, number>(); d = new Set<string>() }').bad).toEqual([])
    })

    it('rejects a third string-keyed map', () => {
      expect(violations('a.ts', maps(3)).bad).toEqual(['a.ts#C'])
    })
  })
})

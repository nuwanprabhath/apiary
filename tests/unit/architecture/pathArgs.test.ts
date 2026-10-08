import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { judge, loadAllow, read, staleReport, walk, type AllowEntry } from './allowlist'

/**
 * Prevents: a new IPC channel through which the renderer hands main a filesystem path to act on.
 * Hard rule (root CLAUDE.md, docs/architecture/boundaries.md, ADR-0001): the renderer never
 * supplies a path that main acts on — main resolves it from an id it already trusts. The few
 * channels that do carry a path-shaped argument are legitimate only because main re-checks it
 * (`GitService.cwdOf` against the stored project rows or a worktree git reported, a confined
 * directory, a native picker...). A new one needs the same check, and a reviewer needs to see it
 * named.
 *
 * Detection is a scan of the `IPC` map in src/shared/ipc/contract.ts. For every `invoke`/`send`
 * channel (and `invokeLoose`/`sendLoose`), each positional argument is path-like when its label matches PATHY (`path`, `cwd`,
 * `dir`, `file`, `folder`, `bin`), or when its declared type, followed through the type aliases
 * and interfaces in src/shared up to four levels deep, has a property that does or the
 * `kind: 'folder'` variant `GitTarget` uses. `event` channels flow main to renderer and are
 * ignored. The scan is textual-structural on purpose (no type checker): it is meant to raise a
 * flag on a new channel, not to prove anything.
 *
 * Allowlist: pathArgs.allow.json, keyed by IPC key, each entry naming the main-side `validator`
 * (`Owner.method`, comma-separated; the test checks each still exists in src/main, so a rename
 * cannot leave a stale claim). It only shrinks: an entry for a channel that no longer carries a
 * path-like argument fails the test.
 */
const PATHY = /path|file|cwd|dir|folder|bin\b/i

interface Channel { key: string, kind: string, why: string[] }

function sourceOf(rel: string): ts.SourceFile {
  return ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
}

/** Every named type declared in src/shared. */
function typeDeclarations(): Map<string, ts.Node[]> {
  const out = new Map<string, ts.Node[]>()
  for (const file of walk(['src/shared'], ['.ts'])) {
    const text = read(file)
    if (!/\b(type|interface)\s/.test(text)) continue
    const visit = (n: ts.Node): void => {
      if (ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) out.set(n.name.text, [...(out.get(n.name.text) ?? []), n])
      ts.forEachChild(n, visit)
    }
    visit(sourceOf(file))
  }
  return out
}

function pathyWithin(node: ts.Node, decls: Map<string, ts.Node[]>, seen: Set<string>, depth: number): string | null {
  let found: string | null = null
  const visit = (n: ts.Node): void => {
    if (found) return
    if (ts.isPropertySignature(n) && ts.isIdentifier(n.name) && PATHY.test(n.name.text)) found = `property "${n.name.text}"`
    else if (ts.isLiteralTypeNode(n) && ts.isStringLiteral(n.literal) && n.literal.text === 'folder') found = "variant kind: 'folder'"
    else if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName) && depth < 4) {
      const name = n.typeName.text
      if (!seen.has(name)) {
        seen.add(name)
        for (const d of decls.get(name) ?? []) {
          const inner = pathyWithin(d, decls, seen, depth + 1)
          if (inner) { found = `${name}.${inner}`; return }
        }
      }
    }
    if (!found) ts.forEachChild(n, visit)
  }
  visit(node)
  return found
}

function pathChannels(): { all: number, pathy: Channel[] } {
  const decls = typeDeclarations()
  const sf = sourceOf('src/shared/ipc/contract.ts')
  const pathy: Channel[] = []
  let all = 0
  const visit = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'IPC' && n.initializer) {
      const lit = ts.isAsExpression(n.initializer) ? n.initializer.expression : n.initializer
      if (!ts.isObjectLiteralExpression(lit)) throw new Error('IPC is no longer an object literal; update pathArgs.test.ts')
      for (const p of lit.properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) || !ts.isCallExpression(p.initializer)) continue
        all += 1
        const call = p.initializer
        const kind = call.expression.getText(sf)
        const tuple = call.typeArguments?.[0]
        if (!['invoke', 'invokeLoose', 'send', 'sendLoose'].includes(kind) || !tuple || !ts.isTupleTypeNode(tuple)) continue
        const why: string[] = []
        for (const el of tuple.elements) {
          const label = ts.isNamedTupleMember(el) ? el.name.text : ''
          const type = ts.isNamedTupleMember(el) ? el.type : el
          const typeText = type.getText(sf)
          // `appMenuInvoke(path: number[])` is a path through the menu tree, not through the disk.
          if (PATHY.test(label) && /\bnumber\b/.test(typeText) && !/\bstring\b/.test(typeText)) continue
          if (PATHY.test(label)) why.push(`argument "${label}"`)
          else {
            const inner = pathyWithin(type, decls, new Set(), 0)
            if (inner) why.push(`${label ? `argument "${label}"` : 'argument'} of type ${type.getText(sf)} (${inner})`)
          }
        }
        if (why.length > 0) pathy.push({ key: p.name.text, kind, why })
      }
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return { all, pathy }
}

describe('IPC channels that carry a path-like argument name their main-side validator', () => {
  const { all, pathy } = pathChannels()
  const allow = loadAllow('pathArgs.allow.json') as (AllowEntry & { validator?: string })[]
  const verdict = judge(pathy.map((c) => c.key), allow)
  const mainFiles = walk(['src/main'], ['.ts']).map(read)

  it('scans the channels (the scan itself is not silently empty)', () => {
    expect(all).toBeGreaterThan(100)
    expect(pathy.map((c) => c.key)).toContain('gitListRefs')
  })

  it('has no path-like channel without an entry naming its validator', () => {
    const byKey = new Map(pathy.map((c) => [c.key, c]))
    expect(verdict.unlisted.map((k) => `${byKey.get(k)?.kind} channel "${k}" takes ${byKey.get(k)?.why.join(', ')}: main must validate it (docs/architecture/boundaries.md), then add the channel to pathArgs.allow.json with the validator's name — or derive the path in main from an id and stop taking it`)).toEqual([])
  })

  it('names a validator that exists in src/main for every entry', () => {
    // "Owner.method" must be a method of `class Owner` in one file; a bare name a function anywhere.
    const defined = (name: string): boolean => {
      const [owner, member] = name.includes('.') ? name.split('.') : [null, name]
      const def = new RegExp(`(^|\\s)(function\\s+|async\\s+|private\\s+|static\\s+)?${member}\\s*[(<]`, 'm')
      return mainFiles.some((t) => (owner === null || new RegExp(`\\bclass ${owner}\\b`).test(t)) && def.test(t))
    }
    const bad = allow.flatMap((e) => (e.validator ?? '').split(/\s*,\s*/).filter((v) => v === '' || !defined(v)).map((v) => `${e.key}: validator "${v}" is not defined in src/main`))
    expect(bad).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('pathArgs.allow.json', verdict.stale)).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import { judge, loadAllow, read, staleReport, walk } from './allowlist'

/**
 * Prevents: the same helper written again instead of imported. Before this test the codebase held
 * `isModel` three times, `own` in two validators, `shellQuote` and the UUID regex twice or more,
 * `defaultExec` five times, `flatten`/`countSessions` in two layers (review §6.3, SHARED-*). Each
 * copy drifts on its own — one gets a bug fixed, the others keep it — and no lint rule sees it,
 * because each file is fine alone. A new copy is cheapest to stop when it is written: the message
 * says where the first definition lives. Shared homes: `@shared/guards` (isRecord, own, oneOf,
 * isOneOf, clamp, isFiniteNumber), `@shared/errors` (errorMessage), `@shared/text` (flattenText),
 * `@shared/domain/ids` (UUID_RE, UUID_PATTERN); the others are in HOMES below.
 *
 * Three checks, over the top-level declarations of every `src/**.ts(x)` file:
 *
 *  (a) NAME — the same name declared at top level in more than one file. Counted: function
 *      declarations, `const` initialised with a function, SCREAMING_CASE `const`s (shared
 *      constants, regexes) and `const default*` (the injectable-exec seams). Not counted: React
 *      components (PascalCase in a .tsx file) and other lower-case module state (`const cache =
 *      new Map()`), which are private to their file by nature. There is no blanket exemption for
 *      `default*` names; a seam that is the same thing lives once (`plugins/remote.ts`).
 *  (c) REGEX — the same regex literal (12+ characters) in more than one file, under any name. A
 *      regex is not a function, so (a) misses `const SESSION_ID = /…/` next to `const UUID = /…/`, and
 *      (b) never sees it; this is how the UUID, control-character and model-id patterns were each
 *      written two or three times.
 *  (b) BODY — a function with five or more statements whose normalised body (every identifier and
 *      literal replaced by a placeholder, whitespace and comments gone because it hashes the AST)
 *      equals one in another file. This catches renamed copies, which a name check cannot.
 *
 * Allowlist: duplicateSymbols.allow.json. A name entry is keyed by the name (`isModel`); a body
 * entry by `body:` + the sorted `file#function` members. Entries marked debt name the ledger item
 * that removes them; the rest are same-named things that are not the same thing, with the reason.
 * It only shrinks: an entry that no longer matches (the copies were merged) fails the test.
 */
const MIN_STATEMENTS = 5
const MIN_REGEX_CHARS = 12

interface Decl { name: string, file: string, fn: ts.FunctionLikeDeclaration | null }

/** Where the one definition of a name that has been merged lives, so the message can say so. */
const HOMES: Record<string, string> = {
  UUID: '`UUID_RE` / `UUID_PATTERN` in @shared/domain/ids',
  UUID_RE: '@shared/domain/ids',
  shellQuote: 'src/main/exec/shellQuote.ts',
  defaultExec: '`defaultExec` in src/main/plugins/remote.ts (a new exec gets its own descriptive name)',
  MODEL_LABELS: 'src/renderer/ui/modelLabels.ts',
  MARGIN: '`POPOVER_MARGIN` in src/renderer/ui/popoverPlacement.ts',
  GAP: '`POPOVER_GAP` in src/renderer/ui/popoverPlacement.ts',
  ensureBound: '`rebindOnNewBridge` in src/renderer/state/bridgeBinding.ts',
  subscribe: '`keyedListeners` in src/renderer/state/bridgeBinding.ts',
  clamp: '@shared/guards',
  errorMessage: '@shared/errors',
}

const isFunctionLike = (n: ts.Node): n is ts.FunctionLikeDeclaration =>
  ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)

/** Every regex literal in a file, as source text. */
function regexLiterals(file: string): string[] {
  const text = read(file)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: string[] = []
  const visit = (n: ts.Node): void => {
    if (n.kind === ts.SyntaxKind.RegularExpressionLiteral && n.getText(sf).length >= MIN_REGEX_CHARS) out.push(n.getText(sf))
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

function declarations(file: string): Decl[] {
  const text = read(file)
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Decl[] = []
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name) out.push({ name: st.name.text, file, fn: st })
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name)) continue
      const init = d.initializer
      const fn = init && isFunctionLike(init) ? init : null
      const name = d.name.text
      if (fn || /^[A-Z][A-Z0-9_]*$/.test(name) || /^default[A-Z]/.test(name)) out.push({ name, file, fn })
    }
  }
  return out
}

function isComponent(d: Decl): boolean {
  return d.file.endsWith('.tsx') && /^[A-Z][a-z]/.test(d.name)
}

/** The AST of a function body as a string of node kinds, identifiers and literals blanked. */
function shape(fn: ts.FunctionLikeDeclaration): { statements: number, hash: string } | null {
  if (!fn.body || !ts.isBlock(fn.body)) return null
  const kinds: string[] = [`params:${String(fn.parameters.length)}`]
  const visit = (n: ts.Node): void => {
    if (ts.isIdentifier(n)) kinds.push('I')
    else if (ts.isStringLiteralLike(n) || ts.isNumericLiteral(n) || n.kind === ts.SyntaxKind.RegularExpressionLiteral) kinds.push('L')
    else {
      kinds.push(String(n.kind))
      ts.forEachChild(n, visit)
      kinds.push(')')
    }
  }
  visit(fn.body)
  return { statements: fn.body.statements.length, hash: createHash('sha1').update(kinds.join(',')).digest('hex') }
}

const rel = (f: string): string => f.replace(/^src\//, '')
/** The canonical home, if there is one, is reported as "the first definition". */
const sharedFirst = (a: string, b: string): number =>
  Number(b.startsWith('src/shared/')) - Number(a.startsWith('src/shared/')) || a.localeCompare(b)

describe('no helper is declared twice', () => {
  const allow = loadAllow('duplicateSymbols.allow.json')
  const decls = walk(['src'], ['.ts', '.tsx'], (p) => p.endsWith('.d.ts')).flatMap(declarations).filter((d) => !isComponent(d))

  const byName = new Map<string, Decl[]>()
  for (const d of decls) byName.set(d.name, [...(byName.get(d.name) ?? []), d])
  const sameName = new Map([...byName]
    .map(([name, ds]): [string, string[]] => [name, [...new Set(ds.map((d) => d.file))].sort(sharedFirst)])
    .filter(([, files]) => files.length > 1))

  const byBody = new Map<string, Decl[]>()
  for (const d of decls) {
    const s = d.fn ? shape(d.fn) : null
    if (s && s.statements >= MIN_STATEMENTS) byBody.set(s.hash, [...(byBody.get(s.hash) ?? []), d])
  }
  const sameBody = new Map<string, string[]>()
  for (const ds of byBody.values()) {
    if (new Set(ds.map((d) => d.file)).size < 2) continue
    const members = ds.map((d) => `${rel(d.file)}#${d.name}`).sort()
    sameBody.set(`body:${members.join(' = ')}`, members)
  }

  const files = walk(['src'], ['.ts', '.tsx'], (p) => p.endsWith('.d.ts'))
  const byRegex = new Map<string, Set<string>>()
  for (const f of files) for (const r of regexLiterals(f)) byRegex.set(r, new Set([...(byRegex.get(r) ?? []), f]))
  const sameRegex = new Map([...byRegex].filter(([, fs]) => fs.size > 1).map(([r, fs]): [string, string[]] => [`regex:${r}`, [...fs].sort(sharedFirst)]))

  const verdict = judge([...sameName.keys(), ...sameBody.keys(), ...sameRegex.keys()], allow)

  it('declares each helper name at top level in one file only', () => {
    const lines = verdict.unlisted.filter((k) => sameName.has(k)).map((name) => {
      const [first, ...rest] = sameName.get(name) ?? []
      const home = HOMES[name] ?? rel(first)
      return `\`${name}\` is already defined in ${home} — import it (shared helpers: @shared/guards, @shared/errors, @shared/text), or add "${name}" to duplicateSymbols.allow.json with a reason. Also declared in: ${(name in HOMES ? [first, ...rest] : rest).map(rel).join(', ')}`
    })
    expect(lines).toEqual([])
  })

  it('has no function body copied (under other names) into a second file', () => {
    const lines = verdict.unlisted.filter((k) => sameBody.has(k)).map((key) => {
      const [first, ...rest] = sameBody.get(key) ?? []
      return `${first} has the same ${String(MIN_STATEMENTS)}+ statement body as ${rest.join(', ')} once names and literals are ignored — extract it to one shared home and import it, or add "${key}" to duplicateSymbols.allow.json with a reason`
    })
    expect(lines).toEqual([])
  })

  it('writes each regex literal in one file only', () => {
    const lines = verdict.unlisted.filter((k) => sameRegex.has(k)).map((key) => {
      const [first, ...rest] = sameRegex.get(key) ?? []
      return `${key.slice('regex:'.length)} is written in ${[first, ...rest].map(rel).join(' and ')} — export it from one home (@shared/domain/ids for ids, @shared/text for stripping control characters, the module that owns the format otherwise) and import it, or add "${key}" to duplicateSymbols.allow.json with a reason`
    })
    expect(lines).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('duplicateSymbols.allow.json', verdict.stale)).toEqual([])
  })
})

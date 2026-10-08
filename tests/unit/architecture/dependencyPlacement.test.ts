import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { judge, loadAllow, read, staleReport, walk } from './allowlist'

/**
 * Prevents: a package that only the renderer imports sitting in `dependencies`. electron-vite
 * bundles the renderer (and every `devDependency` the main bundle imports), so a renderer-only
 * package never needs to be installed at runtime — but electron-builder packs everything in
 * `dependencies` into the asar anyway. `three` (22 MB, imported only by features/pets/render3d)
 * shipped in every installer that way (review TEST-18, ledger B9).
 *
 * The rule: every package in `dependencies` must be imported (static import, `export ... from`,
 * `require()` or `import()`) from `src/main/**`, `src/preload/**` or `src/shared/**` (compiled
 * into main), or have an allowlist entry saying why main loads it some other way. A package
 * imported only from `src/renderer/**` belongs in `devDependencies`. Type-only imports do not
 * count as loading a package.
 *
 * Allowlist: dependencyPlacement.allow.json, keyed by package name. It only shrinks: an entry
 * for a package that is now imported by main (or moved to devDependencies) fails the test.
 */
const MAIN_SIDE = ['src/main/', 'src/preload/', 'src/shared/']

function packageOf(specifier: string): string | null {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@shared/')) return null
  if (specifier.startsWith('node:')) return null
  const parts = specifier.split('/')
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Packages `file` loads at runtime. Parses only when the text mentions a candidate. */
function runtimeImports(rel: string, candidates: string[]): Set<string> {
  const text = read(rel)
  const out = new Set<string>()
  if (!candidates.some((c) => text.includes(c))) return out
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.ES2022, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const add = (n: ts.Expression | undefined): void => {
    if (n && ts.isStringLiteralLike(n)) {
      const pkg = packageOf(n.text)
      if (pkg) out.add(pkg)
    }
  }
  const visit = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && n.importClause?.phaseModifier !== ts.SyntaxKind.TypeKeyword) add(n.moduleSpecifier)
    else if (ts.isExportDeclaration(n) && !n.isTypeOnly) add(n.moduleSpecifier)
    else if (ts.isCallExpression(n) && n.arguments.length > 0
      && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) add(n.arguments[0])
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

describe('runtime dependencies are the ones main loads', () => {
  const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> }
  const deps = Object.keys(pkg.dependencies)
  const allow = loadAllow('dependencyPlacement.allow.json')

  const importedBy = new Map<string, { main: string[], renderer: string[] }>(deps.map((d) => [d, { main: [], renderer: [] }]))
  for (const file of walk(['src'], ['.ts', '.tsx'])) {
    for (const p of runtimeImports(file, deps)) {
      const sites = importedBy.get(p)
      if (!sites) continue
      if (MAIN_SIDE.some((m) => file.startsWith(m))) sites.main.push(file)
      else sites.renderer.push(file)
    }
  }
  const misplaced = deps.filter((d) => importedBy.get(d)?.main.length === 0)
  const verdict = judge(misplaced, allow)

  it('has every dependency imported from src/main, src/preload or src/shared', () => {
    expect(verdict.unlisted.map((d) => {
      const r = importedBy.get(d)?.renderer ?? []
      return r.length > 0
        ? `"${d}" is in dependencies but only the renderer imports it (${r[0]}${r.length > 1 ? ` +${r.length - 1}` : ''}); Vite bundles the renderer, so move it to devDependencies`
        : `"${d}" is in dependencies but nothing imports it — remove it, or add it to dependencyPlacement.allow.json with the reason main loads it`
    })).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('dependencyPlacement.allow.json', verdict.stale)).toEqual([])
  })
})

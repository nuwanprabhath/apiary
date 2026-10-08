import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { ROOT, judge, loadAllow, read, staleReport } from './allowlist'

/**
 * Prevents: one component's render fault blanking the whole window (review UI-24). A render-time
 * throw unmounts everything under the nearest `ErrorBoundary`; the only boundary above `App` is
 * the root one in `main.tsx`, so a component rendered straight into the layout without its own
 * boundary takes the sidebar, every pane and every terminal down with it. The sidebar, each pane
 * and most dialogs already confine themselves; this test keeps the rest from being forgotten.
 *
 * What it checks, with the TypeScript compiler API (no rendering): the JSX returned by `AppWindow`
 * in `app/App.tsx` and by `DialogHost` in `features/dialogs/DialogHost.tsx`. It walks down through
 * plain elements (`div`, ...), fragments, the context providers, `PaneGrid` and conditional/`map`
 * expressions, and stops at every other component — those are the ones that must be protected. A
 * component is protected when it has an `<ErrorBoundary>` ancestor inside that tree, or when it
 * wraps itself: its own function returns `<ErrorBoundary>` as the root (as `ConflictDialog`, the
 * memoised `SidebarShell`, `DialogBoundary` and a generated feature root do; the definition is
 * followed through a feature's `index.ts`). `DialogHost` is skipped inside `App` because its own dialogs
 * are checked here separately, and the SVG glyphs of `ui/icons.tsx` are skipped everywhere.
 *
 * Allowlist: errorBoundaries.allow.json, keyed `<File>.tsx:<Component>`. It only shrinks: an
 * entry for a component that is now protected (or no longer rendered there) fails the test.
 */
const HOSTS = [
  { file: 'src/renderer/app/App.tsx', fn: 'AppWindow' },
  { file: 'src/renderer/features/dialogs/DialogHost.tsx', fn: 'DialogHost' },
]
/** Walked through, not checked: they wrap or place children but render nothing of their own that can fault. */
/** Boundaries: `DialogBoundary` (features/dialogs) is an `ErrorBoundary` with a dialog-shaped fallback. */
const BOUNDARY = /^(ErrorBoundary|DialogBoundary)$/
const TRANSPARENT = /(Context|Provider)$|^(PaneGrid|DialogHost)$/

const parsed = new Map<string, ts.SourceFile>()
function source(rel: string): ts.SourceFile {
  let sf = parsed.get(rel)
  if (!sf) {
    sf = ts.createSourceFile(rel, read(rel), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
    parsed.set(rel, sf)
  }
  return sf
}

const tagOf = (n: ts.JsxElement | ts.JsxSelfClosingElement): string =>
  (ts.isJsxElement(n) ? n.openingElement.tagName : n.tagName).getText()

const isFunctionLike = (n: ts.Node): n is ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression =>
  ts.isFunctionDeclaration(n) || ts.isArrowFunction(n) || ts.isFunctionExpression(n)

/** The function that implements top-level `name`, following `memo(...)`/`forwardRef(...)` and aliases. */
function functionNamed(sf: ts.SourceFile, name: string, depth = 0): ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression | null {
  if (depth > 3) return null
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) return st
    if (!ts.isVariableStatement(st)) continue
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== name || !d.initializer) continue
      const init = d.initializer
      if (isFunctionLike(init)) return init
      if (ts.isCallExpression(init)) {
        for (const a of init.arguments) {
          if (isFunctionLike(a)) return a
          if (ts.isIdentifier(a)) return functionNamed(sf, a.text, depth + 1)
        }
      }
    }
  }
  return null
}

/** The expressions a function returns, not looking inside functions nested in it. */
function returned(fn: ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression): ts.Expression[] {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return [fn.body]
  const out: ts.Expression[] = []
  const visit = (n: ts.Node): void => {
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression)
    else if (n === fn.body || !isFunctionLike(n)) ts.forEachChild(n, visit)
  }
  if (fn.body) visit(fn.body)
  return out
}

function jsxRoots(e: ts.Expression): (ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment)[] {
  if (ts.isParenthesizedExpression(e)) return jsxRoots(e.expression)
  if (ts.isConditionalExpression(e)) return [...jsxRoots(e.whenTrue), ...jsxRoots(e.whenFalse)]
  if (ts.isBinaryExpression(e)) return jsxRoots(e.right)
  return ts.isJsxElement(e) || ts.isJsxSelfClosingElement(e) || ts.isJsxFragment(e) ? [e] : []
}

/** The repo-relative file a relative `specifier` written in `rel` names, or null. */
function resolveModule(rel: string, specifier: string): string | null {
  const base = join(dirname(rel), specifier)
  return ['.tsx', '.ts', '/index.tsx', '/index.ts'].map((x) => base + x).find((f) => existsSync(join(ROOT, f))) ?? null
}

/** Where `name` is imported from, as a repo-relative file, or null when it is declared in `rel`. */
function definitionFile(rel: string, name: string): string | null {
  for (const st of source(rel).statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith('.')) continue
    const bindings = st.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings) || !bindings.elements.some((b) => b.name.text === name)) continue
    return resolveModule(rel, st.moduleSpecifier.text)
  }
  return null
}

/** The function behind `name` as `file` exports it, following `export { name } from './x'` barrels
 *  (a feature's `index.ts`, which is how `npm run new -- feature` hands its root to App). */
function exportedFunction(file: string, name: string, depth = 0): ReturnType<typeof functionNamed> {
  const own = functionNamed(source(file), name)
  if (own || depth > 3) return own
  for (const st of source(file).statements) {
    if (!ts.isExportDeclaration(st) || !st.moduleSpecifier || !ts.isStringLiteral(st.moduleSpecifier) || !st.moduleSpecifier.text.startsWith('.')) continue
    if (!st.exportClause || !ts.isNamedExports(st.exportClause) || !st.exportClause.elements.some((e) => e.name.text === name)) continue
    const next = resolveModule(file, st.moduleSpecifier.text)
    if (next) return exportedFunction(next, name, depth + 1)
  }
  return null
}

/** Whether the component's own function returns `<ErrorBoundary>` as its root. */
function wrapsItself(rel: string, name: string): boolean {
  const fn = exportedFunction(definitionFile(rel, name) ?? rel, name)
  if (!fn) return false
  const roots = returned(fn).flatMap(jsxRoots)
  return roots.length > 0 && roots.every((r) => !ts.isJsxFragment(r) && BOUNDARY.test(tagOf(r)))
}

/** Components `fn` renders into its layout that nothing would catch a fault in. */
function unprotected(host: { file: string, fn: string }): string[] {
  const fn = functionNamed(source(host.file), host.fn)
  if (!fn) throw new Error(`${host.file} no longer defines ${host.fn}; update errorBoundaries.test.ts`)
  const bad = new Set<string>()
  let checked = 0
  const walk = (n: ts.Node, guarded: boolean): void => {
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n)) {
      const tag = tagOf(n)
      const inside = ts.isJsxElement(n) ? n.children : []
      if (/^[a-z]/.test(tag) || TRANSPARENT.test(tag)) inside.forEach((c) => { walk(c, guarded) })
      else if (BOUNDARY.test(tag)) inside.forEach((c) => { walk(c, true) })
      else {
        // Static SVG glyphs (`SidebarIcon` inside a button) have nothing that can fault.
        if (definitionFile(host.file, tag) === 'src/renderer/ui/icons.tsx') return
        checked += 1
        if (!guarded && !wrapsItself(host.file, tag)) bad.add(tag)
      }
      return
    }
    ts.forEachChild(n, (c) => { walk(c, guarded) })
  }
  for (const r of returned(fn)) walk(r, false)
  if (checked === 0) throw new Error(`${host.file}: found no components under ${host.fn}; the scan is broken`)
  return [...bad]
}

describe('components rendered into the app layout and dialog host sit under an ErrorBoundary', () => {
  const allow = loadAllow('errorBoundaries.allow.json')
  const found = new Map<string, string>()
  for (const host of HOSTS) {
    for (const c of unprotected(host)) found.set(`${host.file.split('/').pop() ?? host.file}:${c}`, c)
  }
  const verdict = judge(found.keys(), allow)

  it('leaves no component unprotected', () => {
    expect(verdict.unlisted.map((k) => `<${found.get(k) ?? k}> (${k.split(':')[0]}) has no ErrorBoundary (a render fault would blank the window). Wrap it where it is rendered: <ErrorBoundary label="..." compact> for a bar, fallback={null} for a decorative layer, <DialogBoundary onClose> (features/dialogs) for a dialog in DialogHost; or have its own root return <ErrorBoundary> as ConflictDialog does. See tests/component/regionBoundaries.test.tsx. Do not add it to errorBoundaries.allow.json`)).toEqual([])
  })

  it('follows a feature index.ts to the component it exports, as `npm run new -- feature` hands its root to App', () => {
    // Without this a self-wrapping root imported through its barrel read as unwrapped, and the
    // generator's own output failed the test it tells the next agent to satisfy.
    expect(exportedFunction('src/renderer/features/workspace/index.ts', 'useWorkspaceSelector')).not.toBeNull()
    expect(exportedFunction('src/renderer/features/workspace/index.ts', 'noSuchExport')).toBeNull()
  })

  it('DialogBoundary, which the scan trusts as a boundary, really renders an ErrorBoundary', () => {
    const fn = exportedFunction('src/renderer/features/dialogs/DialogBoundary.tsx', 'DialogBoundary')
    const roots = fn ? returned(fn).flatMap(jsxRoots) : []
    expect(roots.map((r) => (ts.isJsxFragment(r) ? 'fragment' : tagOf(r)))).toEqual(['ErrorBoundary'])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('errorBoundaries.allow.json', verdict.stale)).toEqual([])
  })
})

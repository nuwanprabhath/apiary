import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { judge, loadAllow, read, staleReport } from './allowlist'

/**
 * Prevents: `AppService` growing back into the god object it was (541 → 667 lines and 62 → 74
 * methods between 1.28.0 and 1.32, as chat orchestration and the pets' `latestActions` went in
 * — review MAIN-14). Since §7.3 it is a facade: the IPC handlers and most integration tests call
 * it, and every method forwards to the service that owns the behaviour. Behaviour that is not a
 * forward — take-over, a cwd check, a loop, a second service call — belongs in that service, where
 * it can be tested without IPC.
 *
 * Rule: every method and accessor of `AppService` (src/main/appService.ts) has a body of exactly
 * one statement, `return this.<service>.<method>(...)` or `this.<service>.<method>(...)` (an
 * `await` in front is fine), whose arguments are plain: names, property reads, literals, spreads
 * and object literals of those — no function, condition, operator or nested call. The constructor
 * is exempt.
 *
 * Allowlist: appServiceDelegates.allow.json, keyed `AppService.<name>`, with a reason. It only
 * shrinks: a listed method that has become a plain delegate fails the test.
 */
const FILE = 'src/main/appService.ts'

/** Why `node` (a method body's only statement) is not a plain delegation, or null when it is. */
function whyNotDelegate(statement: ts.Statement): string | null {
  let expr: ts.Expression | undefined
  if (ts.isReturnStatement(statement)) expr = statement.expression
  else if (ts.isExpressionStatement(statement)) expr = statement.expression
  if (expr === undefined) return 'the statement is not a call'
  while (ts.isAwaitExpression(expr) || ts.isParenthesizedExpression(expr)) expr = expr.expression
  if (!ts.isCallExpression(expr)) return 'the statement is not a call'
  const callee = expr.expression
  const viaThisField = ts.isPropertyAccessExpression(callee)
    && ts.isPropertyAccessExpression(callee.expression)
    && callee.expression.expression.kind === ts.SyntaxKind.ThisKeyword
  if (!viaThisField) return 'the call is not `this.<service>.<method>(...)`'
  const bad = expr.arguments.find((a) => !isPlain(a))
  return bad === undefined ? null : `argument \`${bad.getText()}\` is not a plain name, property read or literal`
}

function isPlain(node: ts.Expression): boolean {
  if (ts.isIdentifier(node) || ts.isLiteralExpression(node) || node.kind === ts.SyntaxKind.TrueKeyword
    || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword) return true
  if (ts.isPropertyAccessExpression(node)) return isPlain(node.expression)
  if (ts.isSpreadElement(node)) return isPlain(node.expression)
  if (ts.isObjectLiteralExpression(node)) {
    return node.properties.every((p) => ts.isShorthandPropertyAssignment(p)
      || (ts.isPropertyAssignment(p) && isPlain(p.initializer)))
  }
  return false
}

interface Finding { key: string, why: string }

/** The members of `class AppService` that are not plain delegates. */
function violations(source: string): { methods: number, bad: Finding[] } {
  const file = ts.createSourceFile(FILE, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const cls = file.statements.find((s): s is ts.ClassDeclaration => ts.isClassDeclaration(s) && s.name?.text === 'AppService')
  if (cls === undefined) throw new Error(`${FILE}: class AppService not found`)
  let methods = 0
  const bad: Finding[] = []
  for (const m of cls.members) {
    if (!(ts.isMethodDeclaration(m) || ts.isGetAccessorDeclaration(m)) || m.body === undefined) continue
    methods += 1
    const key = `AppService.${m.name.getText()}`
    const statements = m.body.statements
    if (statements.length !== 1) bad.push({ key, why: `${String(statements.length)} statements` })
    else {
      const why = whyNotDelegate(statements[0])
      if (why !== null) bad.push({ key, why })
    }
  }
  return { methods, bad }
}

describe('AppService stays a facade', () => {
  const found = violations(read(FILE))
  const allow = loadAllow('appServiceDelegates.allow.json')
  const verdict = judge(found.bad.map((b) => b.key), allow)

  it('finds the methods (the scan itself is not silently empty)', () => {
    expect(found.methods).toBeGreaterThan(40)
  })

  it('forwards every method to the service that owns it, or lists it in appServiceDelegates.allow.json with a reason', () => {
    const why = new Map(found.bad.map((b) => [b.key, b.why]))
    expect(verdict.unlisted.map((k) => `${k}: ${why.get(k) ?? ''} — move the behaviour into the service that owns it`)).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('appServiceDelegates.allow.json', verdict.stale)).toEqual([])
  })

  describe('the check itself', () => {
    const check = (body: string): string[] =>
      violations(`class AppService { async m(a: string) { ${body} } }`).bad.map((b) => b.why)

    it('accepts a forward, awaited or not, returned or not', () => {
      expect(check('return this.x.y(a)')).toEqual([])
      expect(check('await this.x.y(a, { b: a }, ...a)')).toEqual([])
      expect(check('this.x.y()')).toEqual([])
    })

    it('rejects logic: a second statement, a condition, a callback, a nested call, a call not on a service', () => {
      expect(check('this.x.y(a); this.z.w(a)')).toHaveLength(1)
      expect(check('if (a) return this.x.y(a)')).toHaveLength(1)
      expect(check('return this.x.y(a ? 1 : 2)')).toHaveLength(1)
      expect(check('return this.x.y(() => a)')).toHaveLength(1)
      expect(check('return this.x.y(this.z.w(a))')).toHaveLength(1)
      expect(check('return this.y(a)')).toHaveLength(1)
      expect(check('return helper(a)')).toHaveLength(1)
    })
  })
})

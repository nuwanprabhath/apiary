import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'

/**
 * Prevents: a renderer API added straight into the preload, around the contract. The preload is
 * generated from `src/shared/ipc/contract.ts` (one loop over `IPC`); its single hand-written entry
 * is `initialTheme`, read synchronously before first paint. A 1.35.0 agent added
 * `getSpellingContext` here as a module `let` that nothing ever assigned, widened the bridge's type
 * with an `as never` cast to get it through, and so shipped a method main could never answer. A
 * call the renderer needs is a contract entry: `npm run new -- ipc <name>`.
 */
const FILE = join(__dirname, '../../../src/preload/index.ts')
const source = ts.createSourceFile(FILE, readFileSync(FILE, 'utf8'), ts.ScriptTarget.Latest, true)

describe('the preload is generated from the contract', () => {
  it('declares no module-level `let` (no state the bridge carries on the side)', () => {
    const lets = source.statements
      .filter(ts.isVariableStatement)
      .filter((s) => (s.declarationList.flags & ts.NodeFlags.Let) !== 0)
      .map((s) => s.getText().split('\n')[0])
    expect(lets, 'Add the call to src/shared/ipc/contract.ts (npm run new -- ipc <name>); the preload derives it.').toEqual([])
  })

  it('hand-writes no entry but initialTheme', () => {
    const keys: string[] = []
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && node.name.getText() === 'api' && node.initializer && ts.isObjectLiteralExpression(node.initializer)) {
        for (const p of node.initializer.properties) keys.push(p.name?.getText() ?? p.getText())
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
    expect(keys, 'A new bridge method is a contract entry, not a hand-written preload key.').toEqual(['initialTheme'])
  })

  it('exposes exactly ApiaryApi (no widened or intersected type, no cast to never)', () => {
    const text = source.getFullText()
    expect(text).toContain('const typedApi: ApiaryApi = api as ApiaryApi')
    expect(text).not.toMatch(/as never/)
  })
})

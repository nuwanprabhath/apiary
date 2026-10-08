import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { read, walk } from './allowlist'

/**
 * Prevents: a cache that answers from memory with nothing saying when the answer goes stale
 * (MAIN-1). `WorktreeResolver` cached a folder's branch for the life of the app, so a `git
 * checkout` done outside Apiary showed only after a full rescan; the cache was written as if the
 * folder could only change through Apiary. What fixes it is a key on the entry (the folder's HEAD
 * stamp), and what keeps the next cache honest is having to write that key down.
 *
 * Rule: a class field under `src/main` named `*cache*` and initialised with a `Map`, `Set` or
 * `WeakMap` carries a doc comment that says what invalidates it ("Invalidated by …": a file stamp,
 * a TTL, a cap, an explicit call). If you cannot finish that sentence, the cache can serve stale
 * answers.
 *
 * No allowlist: every existing cache states its invalidation.
 */
const COLLECTION = /^(Map|Set|WeakMap)$/

function undocumentedCaches(file: string, source: string): { caches: number, bad: string[] } {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  let caches = 0
  const bad: string[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      for (const m of node.members) {
        if (!ts.isPropertyDeclaration(m) || !/cache/i.test(m.name.getText())) continue
        const init = m.initializer
        if (init === undefined || !ts.isNewExpression(init) || !COLLECTION.test(init.expression.getText())) continue
        caches += 1
        const doc = ts.getJSDocCommentsAndTags(m).filter(ts.isJSDoc).map((d) => d.getText()).join('\n')
        if (!/\binvalidated\b/i.test(doc)) bad.push(`${file}#${node.name?.text ?? '(anonymous)'}.${m.name.getText()}`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { caches, bad }
}

describe('a cache states its invalidation', () => {
  const results = walk(['src/main'], ['.ts']).map((f) => undocumentedCaches(f, read(f)))

  it('finds the caches (the scan itself is not silently empty)', () => {
    expect(results.reduce((n, r) => n + r.caches, 0)).toBeGreaterThanOrEqual(4)
  })

  it('documents what invalidates every cache field, with a doc comment saying "Invalidated by …"', () => {
    expect(results.flatMap((r) => r.bad).map((k) => `${k}: add a doc comment "Invalidated by <key, TTL, cap or call>" and make the entry carry that key`)).toEqual([])
  })

  describe('the check itself', () => {
    const check = (src: string): string[] => undocumentedCaches('a.ts', src).bad

    it('accepts a documented cache and ignores fields that are not caches', () => {
      expect(check('class C {\n  /** Invalidated by mtime. */\n  private cache = new Map<string, number>()\n}')).toEqual([])
      expect(check('class C { private seen = new Map<string, number>(); private n = 0 }')).toEqual([])
    })

    it('rejects a cache with no doc, or a doc that does not say what invalidates it', () => {
      expect(check('class C { private cache = new Map<string, number>() }')).toEqual(['a.ts#C.cache'])
      expect(check('class C {\n  /** Holds answers. */\n  private fileCache = new Map<string, number>()\n}')).toEqual(['a.ts#C.fileCache'])
    })
  })
})

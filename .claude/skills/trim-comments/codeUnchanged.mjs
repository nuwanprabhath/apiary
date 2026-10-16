#!/usr/bin/env node
// Proves a trim touched comments only: for every .ts/.tsx/.js/.mjs file changed between <base> and
// HEAD, the token stream with comments and whitespace removed must be identical. Prints each file
// whose code changed and exits 1; prints nothing and exits 0 when only comments moved.
//
//   node .claude/skills/trim-comments/codeUnchanged.mjs <base> [<head>]
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const [base, head = 'HEAD'] = process.argv.slice(2)
if (base === undefined) {
  console.error('usage: codeUnchanged.mjs <base> [<head>]')
  process.exit(2)
}

const git = (...args) => execFileSync('git', args, {
  encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
})
const show = (rev, path) => { try { return git('show', `${rev}:${path}`) } catch { return null } }

// Parsed, not scanned: a bare scanner loses its place after a template literal and starts reading
// comment text as code. The file is printed back without comments, after dropping the empty `{}`
// a JSX comment (`{/* … */}`) leaves, so formatting and comments are the only things ignored.
function tokens(path, text) {
  const kind = /\.(tsx|jsx)$/.test(path) ? ts.ScriptKind.TSX : /\.(js|mjs|cjs)$/.test(path) ? ts.ScriptKind.JS : ts.ScriptKind.TS
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, false, kind)
  const dropEmptyJsx = (context) => (root) => {
    const visit = (node) => {
      if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && node.children.some((c) => ts.isJsxExpression(c) && c.expression === undefined)) {
        const children = node.children.filter((c) => !(ts.isJsxExpression(c) && c.expression === undefined))
        node = ts.isJsxElement(node)
          ? context.factory.updateJsxElement(node, node.openingElement, children, node.closingElement)
          : context.factory.updateJsxFragment(node, node.openingFragment, children, node.closingFragment)
      }
      return ts.visitEachChild(node, visit, context)
    }
    return ts.visitNode(root, visit)
  }
  const [out] = ts.transform(file, [dropEmptyJsx]).transformed
  // Whitespace-only JSX text (the line a deleted JSX comment sat on) is layout, not code.
  return ts.createPrinter({ removeComments: true }).printFile(out).replace(/\s+/g, ' ')
}

const changed = git('diff', '--name-only', `${base}...${head}`).split('\n')
  .filter((p) => /\.(ts|tsx|js|mjs|cjs)$/.test(p))
const differ = changed.filter((p) => {
  const before = show(base, p)
  const after = show(head, p)
  if (before === null || after === null) return true
  return tokens(p, before) !== tokens(p, after)
})
for (const p of differ) console.log(`code changed: ${p}`)
process.exit(differ.length === 0 ? 0 : 1)

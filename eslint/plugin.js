// @ts-check
import { relative, sep } from 'node:path'
import { minimatch } from 'minimatch'
import { SANCTIONED } from './sanctioned.js'

/**
 * The `apiary/*` ESLint rules: "there is one sanctioned way to do X here", one rule per X.
 *
 * Why a local plugin rather than `no-restricted-imports`/`no-restricted-syntax` blocks: those take
 * their allowlist from flat-config `files`/`ignores`, and a later block that sets the same rule for
 * the same files *replaces* the earlier options instead of merging them. Three allowlisted
 * restrictions in `src/main` would need a block per combination, and adding the fourth silently
 * dropped one of the others. Here every rule carries its own allowlist (globs relative to the repo
 * root) and its own name, so `eslint-suppressions.json` can baseline each one separately and a
 * new violation of one rule is never hidden by an old violation of another.
 *
 * The definitions live in `sanctioned.js` — that file is the table to read or extend. Each
 * message names the replacement, because an agent fixes what the error tells it to.
 */

/** @param {string} filename @param {string} cwd */
function repoPath(filename, cwd) {
  return relative(cwd, filename).split(sep).join('/')
}

/** @param {string} file @param {readonly string[] | undefined} globs */
function matchesAny(file, globs) {
  return (globs ?? []).some((g) => minimatch(file, g, { dot: true }))
}

/**
 * @param {import('./sanctioned.js').Sanctioned} def
 * @returns {import('eslint').Rule.RuleModule}
 */
function makeRule(def) {
  return {
    meta: {
      type: 'problem',
      docs: { description: def.description },
      messages: { use: def.message },
      schema: [],
    },
    create(context) {
      const file = repoPath(context.filename, context.cwd)
      if (!matchesAny(file, def.files) || matchesAny(file, def.allow)) return {}

      /** @param {import('eslint').Rule.Node} node */
      const report = (node) => { context.report({ node, messageId: 'use' }) }

      if (def.kind === 'syntax') {
        /** @type {Record<string, (node: import('eslint').Rule.Node) => void>} */
        const visitors = {}
        for (const selector of def.selectors) visitors[selector] = report
        return visitors
      }

      if (def.kind === 'import') {
        const sources = def.sources.map((s) => (typeof s === 'string' ? new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`) : s))
        /** @param {any} node */
        const check = (node) => {
          const source = node.source?.value
          if (typeof source !== 'string' || !sources.some((re) => re.test(source))) return
          if (!def.importNames) { report(node); return }
          if (node.type !== 'ImportDeclaration') { report(node); return }
          for (const spec of node.specifiers) {
            if (spec.type === 'ImportNamespaceSpecifier' || spec.type === 'ImportDefaultSpecifier') { report(spec); continue }
            const name = spec.imported.type === 'Identifier' ? spec.imported.name : String(spec.imported.value)
            if (def.importNames.includes(name)) report(spec)
          }
        }
        return { ImportDeclaration: check, ExportNamedDeclaration: check, ExportAllDeclaration: check }
      }

      // kind === 'global': a free reference to one of these names (not a property, not a local).
      return {
        'Program:exit'(node) {
          const scope = context.sourceCode.getScope(node)
          // typescript-eslint declares the DOM lib's globals as variables of the global scope, so
          // a reference to one resolves to that variable instead of falling through (the same two
          // places core `no-restricted-globals` looks).
          const refs = [...scope.through]
          for (const name of [...def.globals, 'window']) {
            const variable = scope.set.get(name)
            if (variable) refs.push(...variable.references)
          }
          for (const ref of refs) {
            if (def.globals.includes(ref.identifier.name)) report(/** @type {any} */ (ref.identifier))
          }
          // `window.localStorage` reaches the same object without a free reference to its name.
          for (const ref of refs) {
            const parent = /** @type {any} */ (ref.identifier).parent
            if (ref.identifier.name === 'window' && parent?.type === 'MemberExpression' && parent.object === ref.identifier
              && parent.property.type === 'Identifier' && def.globals.includes(parent.property.name)) report(parent)
          }
        },
      }
    },
  }
}

/** @type {import('eslint').ESLint.Plugin} */
const plugin = {
  meta: { name: 'eslint-plugin-apiary' },
  rules: Object.fromEntries(SANCTIONED.map((def) => [def.name, makeRule(def)])),
}

/** Every rule on, as errors — the scoping is inside each rule (`files`/`allow`). */
export const apiaryRules = Object.fromEntries(SANCTIONED.map((def) => [`apiary/${def.name}`, 'error']))

export default plugin

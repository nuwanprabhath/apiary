import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Prevents: a component whose class no stylesheet defines, so it renders with the browser's
 * defaults. The 1.35.0 find bar used `icon-btn` (the class is `icon-button`), shipped grey native
 * buttons on a dark theme, and every test passed: nothing asserted what it looked like.
 *
 * Every static class name in a renderer `className` must appear as a selector in
 * `src/renderer/styles/` or `src/renderer/styles.css`. A class that exists only as a hook for a
 * test or a parent's selector is listed in `classesDefined.allow.json` with its reason; that list
 * only shrinks (root CLAUDE.md, "Guard layer"). Dynamic parts of a template (`${...}`) are skipped.
 */
const ROOT = join(__dirname, '../../..')
const RENDERER = join(ROOT, 'src/renderer')
const ALLOW = join(__dirname, 'classesDefined.allow.json')

function walk(dir: string, ext: RegExp, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, ext, out)
    else if (ext.test(name)) out.push(full)
  }
  return out
}

const css = walk(RENDERER, /\.css$/, []).map((f) => readFileSync(f, 'utf8')).join('\n')
const defined = new Set([...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]))

/** `file: class` for every static class name used in a className attribute. */
function used(): string[] {
  const out: string[] = []
  for (const file of walk(RENDERER, /\.tsx$/, [])) {
    const src = readFileSync(file, 'utf8')
    const rel = relative(ROOT, file).split('\\').join('/')
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\}|\{([^}]*)\})/g)) {
      const literal = m[1] ?? m[2] ?? [...(m[3] ?? '').matchAll(/'([^']*)'/g)].map((q) => q[1]).join(' ')
      for (const c of literal.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/).filter(Boolean)) out.push(`${rel}: ${c}`)
    }
  }
  return [...new Set(out)]
}

describe('every class a component uses is styled', () => {
  const allowed = JSON.parse(readFileSync(ALLOW, 'utf8')) as Record<string, string>
  const all = used()

  it('uses no class that no stylesheet defines', () => {
    const missing = all
      .filter((entry) => !defined.has(entry.slice(entry.lastIndexOf(': ') + 2)) && allowed[entry] === undefined)
      .map((entry) => `${entry} — no stylesheet defines it; use the class the app already has (.btn, .icon-button, .context-menu…) or add its rule`)
    expect(missing).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    const stale = Object.keys(allowed).filter((entry) => !all.includes(entry) || defined.has(entry.slice(entry.lastIndexOf(': ') + 2)))
    expect(stale).toEqual([])
  })
})

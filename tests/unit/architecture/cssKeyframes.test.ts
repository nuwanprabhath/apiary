import { describe, it, expect } from 'vitest'
import { judge, loadAllow, read, staleReport, walk } from './allowlist'

/**
 * Prevents: the same `@keyframes <name>` defined twice. CSS keeps the LAST definition, so two
 * copies are a silent override that depends on file order — and `styles.css` says that order is
 * the cascade, so reordering an `@import` (or a "pure move" split) can change an animation with
 * no error anywhere. `chat-pulse` is defined twice in 33-chat.css with different keyframes today.
 * Reuse the existing animation, or give the new one its own name.
 *
 * Scans `src/renderer/styles.css` and `src/renderer/styles/*.css`, counting a name across files
 * and within one file alike.
 *
 * Allowlist: cssKeyframes.allow.json, keyed by animation name. It only shrinks: an entry for a
 * name that is now defined once fails the test.
 *
 * Also prevents the other half of the same mistake: an `animation:`/`animation-name:` that names
 * keyframes defined nowhere (a rename that missed a user, as B6's fix had to avoid), which CSS
 * ignores without a word. Stylelint's `no-unknown-animations` cannot check this here: it looks
 * at one file, and these partials share keyframes across files.
 */
const KEYFRAMES = /@keyframes\s+([A-Za-z_][\w-]*)/g
const ANIMATION = /(?:^|[;{\s])animation(?:-name)?\s*:\s*([^;}]+)/g
/** Words an `animation` shorthand may hold besides the name. */
const NOT_A_NAME = new Set([
  'none', 'infinite', 'linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end',
  'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards', 'backwards', 'both',
  'running', 'paused', 'initial', 'inherit', 'unset', 'revert', 'important',
])
/** The animation names in one `animation`/`animation-name` value (functions and numbers dropped). */
function namesIn(value: string): string[] {
  const bare = value.replace(/[\w-]+\([^)]*\)/g, ' ').replace(/!important/g, ' ')
  return bare.split(/[\s,]+/).filter((t) => /^[A-Za-z_][\w-]*$/.test(t) && !NOT_A_NAME.has(t))
}

describe('@keyframes names are unique across the renderer stylesheets', () => {
  const allow = loadAllow('cssKeyframes.allow.json')
  const where = new Map<string, string[]>()
  const used: { name: string, site: string }[] = []
  for (const file of walk(['src/renderer'], ['.css'])) {
    const css = read(file).replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    for (const m of css.matchAll(KEYFRAMES)) {
      const line = css.slice(0, m.index).split('\n').length
      where.set(m[1], [...(where.get(m[1]) ?? []), `${file}:${line}`])
    }
    for (const m of css.matchAll(ANIMATION)) {
      const line = css.slice(0, m.index).split('\n').length
      for (const name of namesIn(m[1])) used.push({ name, site: `${file}:${line}` })
    }
  }
  const dupes = new Map([...where].filter(([, sites]) => sites.length > 1))
  const verdict = judge(dupes.keys(), allow)

  it('defines each animation name once', () => {
    expect(
      verdict.unlisted.map((n) => `@keyframes ${n} is defined ${dupes.get(n)?.length} times (${dupes.get(n)?.join(', ')}) — the last one silently wins; reuse it or rename the new one`),
    ).toEqual([])
  })

  it('animates only with keyframes that exist', () => {
    expect(
      used.filter((u) => !where.has(u.name)).map((u) => `${u.site} animates with "${u.name}", which no @keyframes defines — CSS ignores it silently; fix the name or add the keyframes`),
    ).toEqual([])
  })

  it('has no stale allowlist entry', () => {
    expect(staleReport('cssKeyframes.allow.json', verdict.stale)).toEqual([])
  })
})

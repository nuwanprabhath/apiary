/**
 * `reviewUi`: the UI quality gate for one state of the app. For each theme and window width it
 * applies the theme, resizes the window, runs the audit (./audit.ts) and takes a screenshot into
 * `ui-review/` at the repo root. Any audit violation fails the test, listed with the element and
 * the screenshot it is in.
 *
 * The screenshots are for eyes: the lead reviews them against .claude/skills/ui-review/SKILL.md,
 * and `npm run ui:review` lays them out on one page (`ui-review/index.html`). A UI change is not
 * done until its states are in a scenario under tests/component/ui/ and have been looked at.
 *
 * Opening a state (a menu, a find bar, a narrow pane) is the scenario's job: pass it as `open`, so
 * it runs again after each resize and theme change, as a person would see it.
 */
import { page } from 'vitest/browser'
import { expect } from 'vitest'
import { BUILTIN_THEMES } from '@shared/theme/builtins'
import type { ThemeSpec } from '@shared/theme/spec'
import { applyTheme } from '../../../src/renderer/theme/applyTheme'
import { auditUi, type UiViolation } from './audit'
import { mouse, nextFrames } from '../helpers'
import known from './knownDefects.allow.json'

/**
 * Defects that predate the gate, by scenario: `"<rule> <where>": "<reason>"`. Shrink-only, like
 * every baseline here: fix the defect and delete its line; an entry the audit no longer finds
 * fails the scenario until it is deleted. Never add one (root CLAUDE.md, "Guard layer").
 */
const KNOWN: Readonly<Record<string, Readonly<Record<string, string>>>> = known

export type ReviewTheme = 'default' | 'paper' | 'glass'

export interface ReviewOptions {
  /** Window widths to check at. Default: a narrow window and a wide one. */
  widths?: number[]
  height?: number
  themes?: ReviewTheme[]
  /** Brings the state on screen; runs after every resize and theme change. */
  open?: () => Promise<void>
  /** Puts it away again before the next pass (Escape a menu). */
  close?: () => Promise<void>
  /** Audit only inside this element (the default is the whole window). */
  within?: () => Element | null
}

const DEFAULT_WIDTHS = [900, 1400]

/** Where every visible element is, as one string: equal on consecutive frames means laid out. */
function layoutSignature(): string {
  const parts: string[] = []
  // Layout boxes, not painted ones: a spinning icon's transform changes every frame and would never
  // read as settled.
  for (const el of document.body.querySelectorAll<HTMLElement>('*')) {
    if (!(el instanceof HTMLElement) || el.offsetWidth === 0) continue
    parts.push(`${String(el.offsetLeft)},${String(el.offsetTop)},${String(el.offsetWidth)},${String(el.offsetHeight)}`)
  }
  return parts.join(';')
}

/**
 * Waits until nothing has moved for 4 frames (at most 3 s). A fixed few frames was not enough on a
 * loaded machine: the toolbar's overflow fit (a ResizeObserver) had not run yet, so the audit saw a
 * transient layout and reported real defects as fixed.
 */
async function settledLayout(): Promise<void> {
  const deadline = performance.now() + 3000
  let last = layoutSignature()
  let still = 0
  while (still < 4 && performance.now() < deadline) {
    await nextFrames(1)
    const now = layoutSignature()
    still = now === last ? still + 1 : 0
    last = now
  }
}

function themeSpec(theme: ReviewTheme): ThemeSpec | null {
  if (theme === 'default') return null
  const found = BUILTIN_THEMES.find((t) => t.id === `builtin:${theme}`)
  if (found === undefined) throw new Error(`no built-in theme ${theme}`)
  return found.spec
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Check one UI state at each width and theme; fail on any audit violation. */
export async function reviewUi(name: string, opts: ReviewOptions = {}): Promise<void> {
  const widths = opts.widths ?? DEFAULT_WIDTHS
  const themes = opts.themes ?? ['default', 'paper', 'glass']
  const height = opts.height ?? 820
  const found: Array<UiViolation & { shot: string }> = []
  for (const theme of themes) {
    applyTheme(themeSpec(theme))
    for (const width of widths) {
      await page.viewport(width, height)
      // Park the pointer in the window's corner: left where the scenario last clicked (a sidebar row),
      // it opened that row's hover card over the state under review. A scenario that is about a
      // hover moves the pointer again in its own `open`.
      await mouse.move(1, height - 1)
      await settledLayout()
      await opts.open?.()
      await settledLayout()
      const shot = `${slug(name)}--${theme}-${String(width)}.png`
      await page.screenshot({ path: `../../../ui-review/shots/${shot}`, scale: 'device' } as Parameters<typeof page.screenshot>[0])
      const root = opts.within?.() ?? document.body
      for (const v of auditUi(root)) found.push({ ...v, shot })
      await opts.close?.()
    }
  }
  applyTheme(null)
  const knownHere = KNOWN[name] ?? {}
  const seen = new Set(found.map((v) => `${v.rule} ${v.where}`))
  const fresh = found.filter((v) => knownHere[`${v.rule} ${v.where}`] === undefined)
  const report = [...new Set(fresh.map((v) => `  ${v.rule}: ${v.where}: ${v.detail}  (${v.shot})`))]
  const stale = Object.keys(knownHere).filter((k) => !seen.has(k))
  expect(report.length, `UI audit of "${name}" found ${String(report.length)} defect(s); screenshots in ui-review/shots/:\n${report.join('\n')}\n`).toBe(0)
  expect(stale, `Fixed, so delete from tests/component/ui/knownDefects.allow.json under "${name}":\n${stale.join('\n')}\n`).toEqual([])
}

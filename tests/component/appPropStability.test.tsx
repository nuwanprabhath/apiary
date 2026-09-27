/**
 * UI-1 step 1: App used to rebuild every object, array and handler it hands to Sidebar and
 * SessionColumn from scratch on every render — inline arrow functions, a fresh `new Set(...)` and
 * `new Map(...)` every time, an inline `groupState` object literal (see WP L/L2's reports and the
 * review's own evidence at App.tsx 330/1237/1318/1330 and the ~15 inline handlers on
 * SessionColumn). That instability is what blocked UI-1 steps 3-6, UI-19/UI-21's remaining splits
 * and UI-4's memo pass: wrapping any of those components in `React.memo` against props that never
 * stay referentially equal is a no-op, so nothing downstream could be verified as actually working.
 *
 * This test proves the fix at the only place that matters: what App actually hands its two biggest
 * children, measured across a render that has nothing to do with either of them. `vi.mock`-based
 * prop capture (wrapping the Sidebar/SessionColumn modules with a probe) does not work reliably in
 * this project's real-Chromium Vitest browser mode — confirmed directly: a mocked
 * `components/Sidebar` module still resolved to the real, unmocked component even with a static or
 * dynamic re-import, apparently because Vite's dependency pre-bundling for the renderer's entry
 * graph resolves it ahead of the mock registration. So this reads the props React itself already
 * holds: React 18 attaches a `__reactFiber$...`-keyed property to every rendered DOM node, and
 * walking `fiber.return` from a `data-testid` node already used throughout this suite finds the
 * `Sidebar`/`SessionColumn` fiber and its exact `memoizedProps` — the same object identity React
 * itself would compare in a `React.memo` bailout, with nothing mocked and no App/Sidebar/
 * SessionColumn source touched to make it observable.
 */
import { describe, it, expect } from 'vitest'
import { page } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'
import type { ComponentProps } from 'react'
import type { Sidebar as SidebarType } from '../../src/renderer/features/sidebar/Sidebar'
import type { SessionColumn as SessionColumnType } from '../../src/renderer/features/pane/SessionColumn'

type SidebarProps = ComponentProps<typeof SidebarType>
type SessionColumnProps = ComponentProps<typeof SessionColumnType>

interface Fiber {
  type: unknown
  return: Fiber | null
  memoizedProps: Record<string, unknown>
}

function fiberOf(el: Element): Fiber {
  const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))
  if (key === undefined) throw new Error('No React fiber on this element — is it actually mounted?')
  return (el as unknown as Record<string, Fiber>)[key]
}

/** Walks up from a DOM node's fiber to the nearest ancestor whose component function is named
 *  `name` — `Sidebar`/`SessionColumn` here — and returns the exact props object React holds for
 *  it (`fiber.memoizedProps`), the same reference `React.memo`'s default comparator would diff. */
function propsOfAncestor<T>(el: Element, name: string): T {
  let f: Fiber | null = fiberOf(el)
  while (f !== null) {
    if (typeof f.type === 'function' && (f.type as { name: string }).name === name) {
      return f.memoizedProps as T
    }
    f = f.return
  }
  throw new Error(`No "${name}" ancestor fiber found above this element`)
}

describe('App prop stability (UI-1 step 1)', () => {
  it('keeps Sidebar and SessionColumn handlers/collections referentially stable across an unrelated render', async () => {
    const { fake } = await renderApp()
    await until(() => document.querySelector('[data-testid="session-column"]') !== null)

    const sidebarEl = page.getByTestId('sidebar').element()
    const columnEl = document.querySelector('[data-testid="session-column"]')!

    const before = {
      sidebar: propsOfAncestor<SidebarProps>(sidebarEl, 'Sidebar'),
      column: propsOfAncestor<SessionColumnProps>(columnEl, 'SessionColumn'),
    }

    // An unrelated update: a theme option change, read by ThemeEffects alone — nothing Sidebar or
    // SessionColumn receive — driven through the real bridge call the Settings dialog itself uses,
    // not a direct `emit`, so this exercises the same path App runs in the app.
    await window.apiary.themeSetOptions({ animated: false })
    // No prop of either component depends on the theme, so there is nothing to poll for on their
    // side; the settle is instead on the update actually having landed in the fake bridge's state.
    await until(() => fake.state.theme.options.animated === false)
    // One more tick for React to have committed the resulting App re-render.
    await new Promise((r) => { setTimeout(r, 0) })

    const after = {
      sidebar: propsOfAncestor<SidebarProps>(sidebarEl, 'Sidebar'),
      column: propsOfAncestor<SessionColumnProps>(columnEl, 'SessionColumn'),
    }

    // Sanity: this is genuinely a second, distinct render of App — not the same commit re-read.
    expect(after.sidebar).not.toBe(before.sidebar)
    expect(after.column).not.toBe(before.column)

    // Sidebar: handlers, derived collections and callbacks that used to be rebuilt every render.
    expect(after.sidebar.onForkSession).toBe(before.sidebar.onForkSession)
    expect(after.sidebar.onEditNote).toBe(before.sidebar.onEditNote)
    expect(after.sidebar.groupState).toBe(before.sidebar.groupState)
    expect(after.sidebar.collapsed).toBe(before.sidebar.collapsed)
    expect(after.sidebar.onNewSession).toBe(before.sidebar.onNewSession)
    expect(after.sidebar.onSessionDropped).toBe(before.sidebar.onSessionDropped)
    expect(after.sidebar.onStopPending).toBe(before.sidebar.onStopPending)
    expect(after.sidebar.onSelectPending).toBe(before.sidebar.onSelectPending)
    expect(after.sidebar.onFocusTab).toBe(before.sidebar.onFocusTab)
    expect(after.sidebar.pending).toBe(before.sidebar.pending)
    // Already-stable references (useUiState/useCallback from an earlier work package) — checked
    // here too so a regression in either direction shows up in one place.
    expect(after.sidebar.onSelect).toBe(before.sidebar.onSelect)
    expect(after.sidebar.onCollapsedChange).toBe(before.sidebar.onCollapsedChange)

    // SessionColumn: same idea — the column-scoped handlers (from the per-column handlers map,
    // rebuilt only when the set of open column ids changes) and the shared ones alike.
    expect(after.column.column).toBe(before.column.column)
    expect(after.column.sessions).toBe(before.column.sessions)
    expect(after.column.pending).toBe(before.column.pending)
    expect(after.column.resumed).toBe(before.column.resumed)
    expect(after.column.ptyOverrides).toBe(before.column.ptyOverrides)
    expect(after.column.shellTabs).toBe(before.column.shellTabs)
    expect(after.column.activeTerminal).toBe(before.column.activeTerminal)
    expect(after.column.pinnedKeys).toBe(before.column.pinnedKeys)
    expect(after.column.transferFor).toBe(before.column.transferFor)
    expect(after.column.onFocus).toBe(before.column.onFocus)
    expect(after.column.onActivateTab).toBe(before.column.onActivateTab)
    expect(after.column.onCloseTab).toBe(before.column.onCloseTab)
    expect(after.column.onSetView).toBe(before.column.onSetView)
    expect(after.column.onReorderTab).toBe(before.column.onReorderTab)
    expect(after.column.onResume).toBe(before.column.onResume)
    expect(after.column.onRenameSession).toBe(before.column.onRenameSession)
    expect(after.column.onFork).toBe(before.column.onFork)
    expect(after.column.onSessionStarted).toBe(before.column.onSessionStarted)
    expect(after.column.onTabDropped).toBe(before.column.onTabDropped)
    expect(after.column.onDetach).toBe(before.column.onDetach)
    expect(after.column.onStartBottomResize).toBe(before.column.onStartBottomResize)
  })
})

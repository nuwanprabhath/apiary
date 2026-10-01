/**
 * UI-1 step 1 and UI-4: App used to rebuild every object, array and handler it hands to Sidebar and
 * SessionColumn from scratch on every render — inline arrow functions, a fresh `new Set(...)` and
 * `new Map(...)` every time. That instability is what made `React.memo` on those components (and on
 * `SessionRow`) a no-op, so nothing downstream could be verified as actually working.
 *
 * This test proves the fix at the only place that matters: whether the memoised components skip a
 * render that has nothing to do with them. `vi.mock`-based prop capture does not work reliably in
 * this project's real-Chromium Vitest browser mode, so it reads what React itself already holds:
 * React 18 attaches a `__reactFiber$...`-keyed property to every rendered DOM node, and walking
 * `fiber.return` from a `data-testid` node finds the component's fiber and its `memoizedProps`.
 * A component that bailed out of a render keeps the *same* `memoizedProps` object; one that
 * re-rendered gets a new one. That is exactly the comparison `React.memo` makes, with nothing
 * mocked and no source touched to make it observable.
 *
 * The inner function of each memo is what the fiber's `type` names, hence `SidebarShell`,
 * `SessionColumnView` and `SessionRowView`.
 */
import { describe, it, expect } from 'vitest'
import { page } from 'vitest/browser'
import { renderApp } from './renderApp'
import { until } from './helpers'

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
 *  `name` and returns the exact props object React holds for it. */
function propsOfAncestor(el: Element, name: string): Record<string, unknown> {
  let f: Fiber | null = fiberOf(el)
  while (f !== null) {
    if (typeof f.type === 'function' && (f.type as { name: string }).name === name) return f.memoizedProps
    f = f.return
  }
  throw new Error(`No "${name}" ancestor fiber found above this element`)
}

describe('App prop stability and memoisation (UI-1 step 1, UI-4)', () => {
  it('skips Sidebar and SessionColumn on a render of App that has nothing to do with either', async () => {
    const { fake } = await renderApp()
    await until(() => document.querySelector('[data-testid="session-column"]') !== null)

    const sidebarEl = page.getByTestId('sidebar').element()
    const columnEl = document.querySelector('[data-testid="session-column"]')!
    const before = {
      sidebar: propsOfAncestor(sidebarEl, 'SidebarShell'),
      column: propsOfAncestor(columnEl, 'SessionColumnView'),
    }

    // An unrelated update: a theme option change, read by ThemeEffects alone — nothing Sidebar or
    // SessionColumn receive — driven through the real bridge call the Settings dialog itself uses.
    await window.apiary.themeSetOptions({ animated: false })
    await until(() => fake.state.theme.options.animated === false)
    // One more tick for React to have committed the resulting App re-render.
    await new Promise((r) => { setTimeout(r, 0) })

    // Same props objects: App rendered, handed both the same references, and `memo` bailed out.
    expect(propsOfAncestor(sidebarEl, 'SidebarShell')).toBe(before.sidebar)
    expect(propsOfAncestor(columnEl, 'SessionColumnView')).toBe(before.column)
  })

  it('re-renders a session row only when something it shows changed, not when the sidebar does', async () => {
    const { fake } = await renderApp()
    await until(() => page.getByTestId('session-item').elements().length > 0)

    const rowEl = page.getByTestId('session-item').first().element()
    const sidebarEl = page.getByTestId('sidebar').element()
    const before = {
      sidebar: propsOfAncestor(sidebarEl, 'SidebarShell'),
      row: propsOfAncestor(rowEl, 'SessionRowView'),
    }

    // The ~500 ms activity broadcast: it changes Sidebar's own `activeTabs` prop (so the Sidebar
    // genuinely re-renders) while leaving every row's props alone.
    fake.state.tabs = [{ windowNumber: 1, key: 'some-session', view: 'transcript', status: 'running', label: null }]
    fake.emit('activeTabsChanged')
    await until(() => propsOfAncestor(sidebarEl, 'SidebarShell') !== before.sidebar)
    await new Promise((r) => { setTimeout(r, 0) })

    expect(propsOfAncestor(rowEl, 'SessionRowView')).toBe(before.row)
  })
})

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
import { page, userEvent } from 'vitest/browser'
import { renderApp } from './renderApp'
import { clickRowAction, nextFrames, sidebarSession, until } from './helpers'
import { trackRenders } from './renderTracker'

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
    // Frames for React to have committed the resulting App re-render.
    await nextFrames(2)

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
    await nextFrames(1)

    expect(propsOfAncestor(rowEl, 'SessionRowView')).toBe(before.row)
  })
})

/**
 * §7.2: the workspace used to be one context every pane read, so a dispatch aimed at pane A (a tab
 * activation, a pending session, a divider drag) re-rendered pane B's `SessionColumn` too and
 * `memo` bought nothing. Props identity cannot see that (a memo component re-rendered by a context
 * keeps its props object), so this counts real renders through React's commit hook
 * (`renderTracker.ts`).
 */
describe('a change in one pane does not render another (§7.2)', () => {
  function panes(): { a: string; b: string } {
    const cols = [...document.querySelectorAll<HTMLElement>('[data-testid="session-column"]')]
    const active = cols.find((c) => c.dataset.active === 'true')
    const other = cols.find((c) => c.dataset.active !== 'true')
    if (active === undefined || other === undefined) throw new Error('want two panes, one of them focused')
    return { a: active.dataset.columnId!, b: other.dataset.columnId! }
  }

  /** Two panes side by side, the focused one (A) holding two tabs, the other (B) one. */
  async function twoPanes(): Promise<{ a: string; b: string }> {
    await renderApp()
    await userEvent.click(sidebarSession('Fix CSV export bug'))
    await clickRowAction('Add worktree switcher', 'split-session-button')
    await until(() => document.querySelectorAll('[data-testid="session-column"]').length === 2)
    const ids = panes()
    // The next click opens in the focused pane, giving it a second tab.
    const focused = document.querySelector<HTMLElement>(`[data-column-id="${ids.a}"]`)!
    await userEvent.click(focused)
    await userEvent.click(sidebarSession('Repo root session'))
    await until(() => focused.querySelectorAll('[data-testid="session-tab"]').length === 2)
    return panes()
  }

  /** Two animation frames: the commit a dispatch caused, and any effect it scheduled, are done. */
  async function settle(): Promise<void> {
    await new Promise((r) => { requestAnimationFrame(r) })
    await new Promise((r) => { requestAnimationFrame(r) })
  }

  it('activating a tab in pane A renders pane A and not pane B', async () => {
    const { a, b } = await twoPanes()
    const inA = document.querySelector<HTMLElement>(`[data-column-id="${a}"]`)!
    const inactiveTab = [...inA.querySelectorAll<HTMLElement>('[data-testid="session-tab"]')]
      .find((t) => t.dataset.active !== 'true')!.querySelector<HTMLElement>('[role="tab"]')!
    const renders = trackRenders('SessionColumnView')
    await userEvent.click(inactiveTab)
    await settle()
    expect(renders.read().get(a) ?? 0).toBeGreaterThan(0)
    expect(renders.read().get(b) ?? 0).toBe(0)
    renders.stop()
  })

  it('a new pending session opened in pane A does not render pane B', async () => {
    const { a, b } = await twoPanes()
    const renders = trackRenders('SessionColumnView')
    const group = [...document.querySelectorAll<HTMLElement>('[data-testid="project-group"]')]
      .find((g) => g.querySelector('.project-label')?.textContent === 'work-a')!
    const plus = group.querySelector<HTMLElement>('[data-testid="new-session-button"]')!
    await userEvent.click(plus)
    await until(() => document.querySelectorAll(`[data-column-id="${a}"] [data-testid="session-tab"]`).length === 3)
    await settle()
    expect(renders.read().get(a) ?? 0).toBeGreaterThan(0)
    expect(renders.read().get(b) ?? 0).toBe(0)
    renders.stop()
  })

  it('dragging the divider between the panes renders neither', async () => {
    const { a, b } = await twoPanes()
    const renders = trackRenders('SessionColumnView')
    const divider = page.getByTestId('column-resizer').element()
    divider.focus()
    await userEvent.keyboard('{ArrowRight}')
    await userEvent.keyboard('{ArrowRight}')
    await settle()
    expect(renders.read().get(a) ?? 0).toBe(0)
    expect(renders.read().get(b) ?? 0).toBe(0)
    renders.stop()
  })
})

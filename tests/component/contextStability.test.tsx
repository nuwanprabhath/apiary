/**
 * UI-5: the notification and layout-actions contexts used to hand every consumer a brand new
 * value object on every render that touched them — every toast shown or dismissed for
 * notifications, every App render (any column, tab or pane change) for layout actions. That
 * defeats `React.memo` on everything below them (SessionRow, FolderHeader, every tab strip), since
 * a memoised component still re-renders when a context value it reads changes identity.
 *
 * These tests measure identity, not pixels: they count how many *distinct* objects a consumer
 * hook returns while its provider is exercised the way the app exercises it, mounting only the
 * provider (or a probe that receives the same values App wires up), not the whole renderer.
 */
import { describe, it, expect } from 'vitest'
import { createRoot } from 'react-dom/client'
import type { ReactNode } from 'react'
import {
  NotificationProvider, useNotifications, useNotificationItems, type Notification,
} from '../../src/renderer/ui/notifications'

function mount(node: ReactNode): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  root.render(node)
  return { host, unmount: () => { root.unmount(); host.remove() } }
}

describe('context stability (UI-5)', () => {
  it('useNotifications() keeps one identity across toasts; only useNotificationItems() changes', async () => {
    const actionsSeen = new Set<ReturnType<typeof useNotifications>>()
    const itemsSeen = new Set<Notification[]>()
    let notify: ReturnType<typeof useNotifications>['notify'] = () => ''

    function Probe(): null {
      const api = useNotifications()
      const items = useNotificationItems()
      actionsSeen.add(api)
      itemsSeen.add(items)
      notify = api.notify
      return null
    }

    const { unmount } = mount(<NotificationProvider><Probe /></NotificationProvider>)
    await new Promise((r) => { setTimeout(r, 0) })

    for (let i = 0; i < 5; i++) {
      notify({ message: `toast ${i}`, timeoutMs: null })
      await new Promise((r) => { setTimeout(r, 0) })
    }

    // Measured against the pre-UI-5 code (`items` folded into the same object
    // `useNotifications()` returned): 6 distinct action identities for 5 toasts (1 initial + 1
    // per notify). After the split: exactly 1.
    expect(actionsSeen.size).toBe(1)
    // The items list itself is expected to change on every toast — that context still exists
    // precisely so the one component that needs it (NotificationCenter) can react to it.
    expect(itemsSeen.size).toBe(6)
    unmount()
  })

  it('a component reading only actions does not re-render when a toast is shown', async () => {
    let renderCount = 0
    let notify: ReturnType<typeof useNotifications>['notify'] = () => ''

    function ActionsOnlyProbe(): null {
      const api = useNotifications()
      renderCount++
      notify = api.notify
      return null
    }

    const { unmount } = mount(<NotificationProvider><ActionsOnlyProbe /></NotificationProvider>)
    await new Promise((r) => { setTimeout(r, 0) })
    const before = renderCount
    expect(before).toBe(1)

    notify({ message: 'noisy toast 1', timeoutMs: null })
    notify({ message: 'noisy toast 2', timeoutMs: null })
    notify({ message: 'noisy toast 3', timeoutMs: null })
    await new Promise((r) => { setTimeout(r, 0) })

    // Measured against the pre-UI-5 code: 2 renders (1 initial + 1 batched re-render for the
    // three notify() calls). After the split: still 1 — a component that only reads actions is
    // untouched by toast churn.
    expect(renderCount).toBe(before)
    unmount()
  })
})

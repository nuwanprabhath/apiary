import { useEffect, useRef, useState } from 'react'
import type { ActiveTabPayload } from '@shared/api'

/**
 * Field-by-field equality on the payload's own fields (UI-4): main coalesces `activeTabsChanged`
 * to twice a second while any pty is printing, so without this every tick handed out a fresh array
 * — even when nothing in it actually changed — and every consumer (App, and anything reading
 * activity status) re-rendered on the same schedule. `windowNumber`/`key` identify the tab;
 * `view`/`status`/`label` are the only fields that can change under it.
 */
export function tabsEqual(a: ActiveTabPayload[], b: ActiveTabPayload[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.windowNumber !== y.windowNumber || x.key !== y.key || x.view !== y.view
      || x.status !== y.status || x.label !== y.label
    ) return false
  }
  return true
}

/** Every open tab across every window, with its derived activity status, kept live. */
export function useActiveTabs(): ActiveTabPayload[] {
  const [tabs, setTabs] = useState<ActiveTabPayload[]>([])
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void window.apiary.activeTabs().then((next) => {
        if (cancelled) return
        // Keep the previous array (and its identity) when nothing in it actually changed, so a
        // memoised consumer downstream does not re-render on every coalesced broadcast.
        if (!tabsEqual(tabsRef.current, next)) setTabs(next)
      }).catch(() => {
        // Background poll (UI-23): a transient failure just leaves the list showing what it last
        // knew. `onActiveTabsChanged` fires again on its own within a second or two whenever
        // anything is running, so this is not a dead end, just a skipped tick.
      })
    }
    refresh()
    const unsubscribe = window.apiary.onActiveTabsChanged(refresh)
    return () => { cancelled = true; unsubscribe() }
  }, [])

  return tabs
}

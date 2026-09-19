import { useEffect, useState } from 'react'
import type { ActiveTabPayload } from '@shared/api'

/** Every open tab across every window, with its derived activity status, kept live. */
export function useActiveTabs(): ActiveTabPayload[] {
  const [tabs, setTabs] = useState<ActiveTabPayload[]>([])

  useEffect(() => {
    let cancelled = false
    const refresh = (): void => {
      void window.apiary.activeTabs().then((next) => { if (!cancelled) setTabs(next) })
    }
    refresh()
    const unsubscribe = window.apiary.onActiveTabsChanged(refresh)
    return () => { cancelled = true; unsubscribe() }
  }, [])

  return tabs
}

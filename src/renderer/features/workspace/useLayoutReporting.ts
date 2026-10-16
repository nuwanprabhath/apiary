import { useEffect, useMemo, useRef } from 'react'
import { asPtyId } from '@shared/domain/ids'
import { buildPersistedLayout } from '@shared/layoutReport'
import { windowNumber as getWindowNumber } from '../../state/windowParams'
import { useWorkspace } from './useWorkspaceSelector'
import { onRequestLayoutFlush, reportLayout, reportTabs } from '../../state/tabs'

/** Reports the layout (never for a torn-off window) and the open tabs (every window) to main. Dispatches nothing. */
export function useLayoutReporting(detached: string | null): void {
  const { layout, shellTabs, activeTerminal, ptyOverrides, resumed, pending } = useWorkspace()
  const columns = layout.panes
  // Memoized so the debounce effects restart only when tabs change.
  const openKeys = useMemo(
    () => new Set(columns.flatMap((c) => c.tabs.map((t) => t.key))),
    [columns],
  )

  const windowNumber = useMemo(() => getWindowNumber(), [])

  /** The actual send, in a ref so main's flush-before-quit can call it past the debounce; refreshed
   *  every render so it closes over the latest state. */
  const reportLayoutNowRef = useRef<() => void>(() => {})
  reportLayoutNowRef.current = () => {
    const persistedLayout = buildPersistedLayout(layout, shellTabs, activeTerminal, ptyOverrides)
    const live = [...resumed].filter((id) => openKeys.has(id))
    reportLayout({ number: windowNumber, layout: persistedLayout, live })
  }

  /**
   * Not gated on `detached`, or the Active section would not list a torn-off window.
   *
   * `resumed` marks a tab as running a pty at all; `ptyOverrides` says which id its process runs
   * under (as in `transferFor` and `buildPersistedLayout`).
   */
  const reportTabsNowRef = useRef<() => void>(() => {})
  reportTabsNowRef.current = () => {
    reportTabs(columns.flatMap((c) => c.tabs).map((t) => {
      const p = pending.get(t.key)
      return {
        key: t.key,
        view: t.view,
        ptyId: resumed.has(t.key) ? (ptyOverrides.get(t.key) ?? asPtyId(t.key)) : null,
        // What the tab bar shows for a tab with no session yet; Active has no other name for it.
        label: p === undefined ? null : (p.titleOverride ?? p.label),
      }
    }))
  }

  // Debounced so churn does not spam IPC and the disk write behind it.
  useEffect(() => {
    if (detached !== null) return
    const timer = setTimeout(() => { reportLayoutNowRef.current() }, 500)
    return () => { clearTimeout(timer) }
  }, [layout, shellTabs, activeTerminal, ptyOverrides, resumed, openKeys, detached, windowNumber])

  // Same debounce and state as the layout so the registry and the persisted record agree.
  useEffect(() => {
    const timer = setTimeout(() => { reportTabsNowRef.current() }, 500)
    return () => { clearTimeout(timer) }
  }, [layout, shellTabs, activeTerminal, ptyOverrides, resumed, openKeys, windowNumber, pending])

  /**
   * Quitting can land inside the debounce above. Main's `before-quit` broadcasts this request and
   * waits (bounded) for each window to report before it writes the file.
   */
  useEffect(() => {
    if (detached !== null) return
    return onRequestLayoutFlush(() => { reportLayoutNowRef.current() })
  }, [detached])
}

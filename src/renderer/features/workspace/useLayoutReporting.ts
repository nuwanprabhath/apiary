import { useEffect, useMemo, useRef } from 'react'
import { asPtyId } from '@shared/domain/ids'
import { buildPersistedLayout } from '@shared/layoutReport'
import { windowNumber as getWindowNumber } from '../../state/windowParams'
import { useWorkspace } from './useWorkspaceSelector'
import { onRequestLayoutFlush, reportLayout, reportTabs } from '../../state/tabs'

/**
 * Reports this window to main: the restorable layout (never for a torn-off window), the open tabs
 * for the Active section (every window), and an immediate layout flush when main asks before quit.
 * Read-only on the workspace — it dispatches nothing.
 */
export function useLayoutReporting(detached: string | null): void {
  const { layout, shellTabs, activeTerminal, ptyOverrides, resumed, pending } = useWorkspace()
  const columns = layout.panes
  /** Every key open in some column. Memoized on the columns so the debounce effects below restart
   *  only when the open tabs actually change, not on every render. */
  const openKeys = useMemo(
    () => new Set(columns.flatMap((c) => c.tabs.map((t) => t.key))),
    [columns],
  )

  /** This window's own number, the same key `uiState.ts`'s `stateKey()` reads from the URL. */
  const windowNumber = useMemo(() => getWindowNumber(), [])

  /**
   * The actual send, kept in a ref rather than only inside the debounced effect below so it can
   * also be called *immediately*, bypassing the debounce, when main asks for a flush before quit
   * (see the `onRequestLayoutFlush` effect). The ref is refreshed on every render so it always
   * closes over the latest layout/shell state, the same values the debounced call would have used.
   */
  const reportLayoutNowRef = useRef<() => void>(() => {})
  reportLayoutNowRef.current = () => {
    const persistedLayout = buildPersistedLayout(layout, shellTabs, activeTerminal, ptyOverrides)
    const live = [...resumed].filter((id) => openKeys.has(id))
    reportLayout({ number: windowNumber, layout: persistedLayout, live })
  }

  /**
   * What this window has open, for the Active section — a separate report from the layout one
   * above, and deliberately not gated on `detached`.
   *
   * These two were once the same send, which quietly made the Active section blind to exactly the
   * windows it exists for: a torn-off window is excluded from the *layout* record (it is not part
   * of the restorable arrangement), and that exclusion took its tab report with it. A session
   * dragged out to a second screen — the case where you most need to see at a glance that it is
   * running or waiting on you — was the one case mission control never listed.
   *
   * `resumed` is what marks a tab as actually running a pty at all (a plain transcript tab nobody
   * has resumed has none); `ptyOverrides` is the same "which id does its process actually run
   * under" lookup `transferFor` and `buildPersistedLayout` already use.
   */
  const reportTabsNowRef = useRef<() => void>(() => {})
  reportTabsNowRef.current = () => {
    reportTabs(columns.flatMap((c) => c.tabs).map((t) => {
      const p = pending.get(t.key)
      return {
        key: t.key,
        view: t.view,
        ptyId: resumed.has(t.key) ? (ptyOverrides.get(t.key) ?? asPtyId(t.key)) : null,
        // What the tab bar shows for a tab with no session yet — Active, in any window, has no
        // other way to name it, and fell back to the raw `new:<uuid>` key.
        label: p === undefined ? null : (p.titleOverride ?? p.label),
      }
    }))
  }

  /**
   * Reports this window's layout to main, debounced ~500ms so a drag or a burst of tab churn does
   * not spam the IPC channel and the disk write behind it. `detached` windows are excluded: a
   * torn-off single-tab window is not part of the restorable arrangement.
   */
  useEffect(() => {
    if (detached !== null) return
    const timer = setTimeout(() => { reportLayoutNowRef.current() }, 500)
    return () => { clearTimeout(timer) }
  }, [layout, shellTabs, activeTerminal, ptyOverrides, resumed, openKeys, detached, windowNumber])

  /**
   * Reports this window's open tabs, every window including a detached one. Debounced on the same
   * 500ms as the layout report above and driven by the same state, so the registry and the
   * persisted record still agree about an ordinary window — but a torn-off window reports too,
   * which is the whole point of keeping this separate (see `reportTabsNowRef`).
   */
  useEffect(() => {
    const timer = setTimeout(() => { reportTabsNowRef.current() }, 500)
    return () => { clearTimeout(timer) }
  }, [layout, shellTabs, activeTerminal, ptyOverrides, resumed, openKeys, windowNumber, pending])

  /**
   * Quitting can land inside the 500ms debounce above — close the last tab in a pane, then Cmd+Q
   * within half a second, and without this the persisted record would still show that tab. Main's
   * `before-quit` handler broadcasts this request to every window and waits (briefly, bounded) for
   * each to report before it writes the file, so the on-disk state always reflects what was open
   * the instant before quit actually happened.
   */
  useEffect(() => {
    if (detached !== null) return
    return onRequestLayoutFlush(() => { reportLayoutNowRef.current() })
  }, [detached])
}

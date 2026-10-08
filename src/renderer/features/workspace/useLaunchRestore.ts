import { asSessionId } from '@shared/domain/ids'
import { useEffect, useRef } from 'react'
import type { TabTransfer, WindowLayoutReport } from '@shared/types'
import { useNotifications } from '../../ui/notifications'
import { treeStore } from '../../state/treeStore'
import { findSessionById } from '@shared/treeWalk'
import { useWorkspaceDispatch } from './workspaceContext'
import { background } from '../../state/policy'
import { resumeSession } from '../../state/sessions'

/**
 * What a window does once, at launch, to get back to where it was: resume the sessions that were
 * live at quit, and reopen the tab that was in front (or the one a torn-off window was opened to
 * show). `selectedSessionId` is the persisted record the second half reads; App writes it back as
 * the active tab changes.
 */
export function useLaunchRestore({ restored, detached, arrival, selectedSessionId }: {
  restored: WindowLayoutReport | null
  detached: string | null
  arrival: TabTransfer | null
  selectedSessionId: string | null
}): void {
  const { notifyError } = useNotifications()
  const dispatch = useWorkspaceDispatch()
  /**
   * Sessions recorded as live at quit are resumed the same way a manual "Resume" click is —
   * `window.apiary.resume` already spawns `claude --resume` and is what `startResume` calls.
   * Restore is not a special code path for spawning; it is a special *reason* to call the
   * ordinary one, once, for each id the main process already pruned down to sessions that still
   * resolve (see `pruneStaleLive`/`sessionIsResumable`).
   */
  // `restored` itself never changes after mount (see its `useState` above, which has no setter in
  // use), so this is safe without StrictMode's double-invoke. The ref latch makes that true on its
  // own terms too, rather than leaning on "there is no StrictMode double-invoke" staying true
  // forever (UI-15 item 1).
  const resumedRestoredRef = useRef(false)
  useEffect(() => {
    if (restored === null || resumedRestoredRef.current) return
    resumedRestoredRef.current = true
    for (const sessionId of restored.live) {
      // Main already dropped anything unresumable; a spawn failure here is logged, not toasted
      // once per restored session at launch.
      background(resumeSession(asSessionId(sessionId)).then(() => { dispatch({ type: 'resumed/add', key: sessionId }) }), 'resume')
    }
    // Deliberately runs only once: the ref latch (not just the empty dep list) is what stops a
    // StrictMode double-invoke from resuming every restored session twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; the ref latch stops a StrictMode double-invoke resuming each session twice
  }, [])

  // Restore the previously selected session on launch, once, from the id persisted last time.
  // If it no longer exists in the freshly loaded tree, fall back to no selection.
  const restoreAttempted = useRef(false)
  useEffect(() => {
    if (restoreAttempted.current) return
    restoreAttempted.current = true
    // A detached window opens the tab it was torn off to show; an ordinary one reopens whatever
    // was last in front. Same machinery either way — the only difference is which id.
    const id = detached ?? selectedSessionId
    if (id === null) return
    let cancelled = false
    treeStore.current()
      .then((nodes) => {
        if (cancelled) return
        const found = findSessionById(nodes, id)
        if (!found) return
        dispatch({ type: 'session/open', session: found, split: false })
        if (arrival !== null && arrival.view !== 'transcript') {
          dispatch({ type: 'tab/showView', key: found.sessionId, view: arrival.view })
        }
      })
      .catch((e: unknown) => {
        // Restoring the previous selection is best-effort — the app is perfectly usable with
        // nothing selected — so this is a warning rather than an error, and it says so instead
        // of leaving the user to wonder why the session they had open didn't come back.
        notifyError(e, 'Could not reopen the last session')
      })
    return () => { cancelled = true }
    // Listing dispatch or notifyError would cancel the in-flight restore on the first focus change,
    // silently losing it while restoreAttempted blocks the effect from ever running again.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listing dispatch or notifyError would cancel the in-flight restore on the first focus change
  }, [])
}

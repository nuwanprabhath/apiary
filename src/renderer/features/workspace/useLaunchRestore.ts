import { asSessionId } from '@shared/domain/ids'
import { useEffect, useRef } from 'react'
import type { TabTransfer, WindowLayoutReport } from '@shared/types'
import { useNotifications } from '../../ui/notifications'
import { treeStore } from '../../state/treeStore'
import { findSessionById } from '@shared/treeWalk'
import { useWorkspaceDispatch } from './workspaceContext'
import { background } from '../../state/policy'
import { resumeSession } from '../../state/sessions'

/** `selectedSessionId` is the persisted record the reopen step reads; App writes it back as the active tab changes. */
export function useLaunchRestore({ restored, detached, arrival, selectedSessionId }: {
  restored: WindowLayoutReport | null
  detached: string | null
  arrival: TabTransfer | null
  selectedSessionId: string | null
}): void {
  const { notifyError } = useNotifications()
  const dispatch = useWorkspaceDispatch()
  // Sessions live at quit are resumed through the ordinary resume call, once per id main already
  // pruned to sessions that still resolve (`pruneStaleLive`/`sessionIsResumable`). `restored`
  // never changes after mount; the ref latch also covers a StrictMode double-invoke.
  const resumedRestoredRef = useRef(false)
  useEffect(() => {
    if (restored === null || resumedRestoredRef.current) return
    resumedRestoredRef.current = true
    for (const sessionId of restored.live) {
      // Main already dropped anything unresumable; a spawn failure here is logged, not toasted
      // once per restored session at launch.
      background(resumeSession(asSessionId(sessionId)).then(() => { dispatch({ type: 'resumed/add', key: sessionId }) }), 'resume')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once; the ref latch stops a StrictMode double-invoke resuming each session twice
  }, [])

  const restoreAttempted = useRef(false)
  useEffect(() => {
    if (restoreAttempted.current) return
    restoreAttempted.current = true
    // A detached window opens the tab it was torn off to show; an ordinary one the last in front.
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
        notifyError(e, 'Could not reopen the last session')
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- listing dispatch or notifyError would cancel the in-flight restore on the first focus change
  }, [])
}

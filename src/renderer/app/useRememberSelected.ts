import { type Dispatch, type SetStateAction, useEffect } from 'react'
import type { ViewerUiState } from '../state/uiState'

/**
 * Remembers which session is in front, so the next launch can reopen it (the restore effect
 * consumes this). Deliberately never writes `null`: a pending tab has no session id worth
 * persisting, and blanking it while the app happens to have no tabs open would throw away the
 * restore target before the asynchronous restore has had a chance to use it.
 */
export function useRememberSelected(
  activeKey: string | null, pending: ReadonlyMap<string, unknown>, setUi: Dispatch<SetStateAction<ViewerUiState>>,
): void {
  useEffect(() => {
    if (activeKey === null || pending.has(activeKey)) return
    setUi((prev) => (prev.selectedSessionId === activeKey ? prev : { ...prev, selectedSessionId: activeKey }))
  }, [activeKey, pending, setUi])
}

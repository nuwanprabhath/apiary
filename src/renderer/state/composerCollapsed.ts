import { useCallback } from 'react'
import { createLocalStore } from './createLocalStore'
import { loadComposerCollapsed, saveComposerCollapsed } from './uiState'

/**
 * The saved value is the source of truth (`state/uiState.ts`); this store only counts changes so
 * every composer in the window re-renders together when one folds or unfolds the box.
 */
const changes = createLocalStore(0)

/** Whether the message box is folded away: one preference for every pane's composer. */
export function useComposerCollapsed(): [boolean, (collapsed: boolean) => void] {
  changes.useStore()
  const set = useCallback((collapsed: boolean) => {
    saveComposerCollapsed(collapsed)
    changes.set((n) => n + 1)
  }, [])
  return [loadComposerCollapsed(), set]
}

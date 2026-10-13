import { useCallback } from 'react'
import { createLocalStore } from './createLocalStore'
import { loadFoldedPanes, saveFoldedPanes } from './uiState'

/**
 * The saved record is the source of truth (`state/uiState.ts`, this window's own key); this store
 * only counts changes so a pane's composer re-renders when its fold changes.
 */
const changes = createLocalStore(0)

/** Whether the pane's message box is folded away: each pane has its own, a new pane starts open. */
export function useComposerCollapsed(columnId: string): [boolean, (collapsed: boolean) => void] {
  changes.useStore()
  const set = useCallback((collapsed: boolean) => {
    const folded = loadFoldedPanes()
    if (collapsed) folded[columnId] = true
    else delete folded[columnId]
    saveFoldedPanes(folded)
    changes.set((n) => n + 1)
  }, [columnId])
  return [loadFoldedPanes()[columnId] === true, set]
}

/** Forgets the folds of panes that no longer exist, so the record does not grow with every pane ever opened. */
export function pruneFoldedPanes(liveColumnIds: readonly string[]): void {
  const folded = loadFoldedPanes()
  const gone = Object.keys(folded).filter((id) => !liveColumnIds.includes(id))
  if (gone.length === 0) return
  for (const id of gone) delete folded[id]
  saveFoldedPanes(folded)
  changes.set((n) => n + 1)
}

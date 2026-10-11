import { type Dispatch, useMemo } from 'react'
import type { TabTransfer } from '@shared/types'
import { findColumnWithTab, type Column, type OpenTab } from '../state/columns'
import type { WorkspaceAction } from '../features/workspace/workspaceReducer'
import { useWorkspaceStore } from '../features/workspace/workspaceContext'
import { adoptTabHere } from '../state/tabs'

export interface ColumnHandlers {
  onFocus: () => void
  onActivateTab: (key: string) => void
  onCloseTab: (key: string) => void
  onSetView: (key: string, view: OpenTab['view']) => void
  onReorderTab: (key: string, toIndex: number, transfer: TabTransfer | null) => void
}

/**
 * Per-column handlers, one set per open column id — a fresh closure over `column.id` per column on
 * every render is what building them inline in `columns.map(...)` used to cost. Rebuilt only when
 * the set of open column ids changes (a split, a close, a layout change), by keying the memo on the
 * ids themselves rather than the `columns` array reference (which also changes on any tab
 * open/close inside an existing column).
 */
export function useColumnHandlers(columns: Column[], dispatch: Dispatch<WorkspaceAction>): Map<string, ColumnHandlers> {
  const store = useWorkspaceStore()
  const columnIdsSignature = columns.map((c) => c.id).join(' ')
  return useMemo(() => {
    const map = new Map<string, ColumnHandlers>()
    for (const columnId of columnIdsSignature === '' ? [] : columnIdsSignature.split(' ')) {
      map.set(columnId, {
        onFocus: () => { dispatch({ type: 'column/focus', columnId }) },
        onActivateTab: (key) => { dispatch({ type: 'tab/activate', columnId, key }) },
        // Closes a tab, dropping the column with it — unless it is the last one, which stays as an
        // empty placeholder so the layout never collapses to nothing.
        onCloseTab: (key) => { dispatch({ type: 'tab/close', columnId, key }) },
        onSetView: (key, view) => { dispatch({ type: 'tab/setView', columnId, key, view }) },
        onReorderTab: (key, toIndex, transfer) => {
          // Not open anywhere in this window: it came from another one, whose drop the platform
          // delivered here rather than as a `dragend` over nothing (X11 does this). Moving it
          // within this window would silently do nothing — the reported "dragging it back to the
          // main window does nothing" — so ask the main process to hand it over instead.
          if (findColumnWithTab(store.getState().layout.panes, key) === null) {
            if (transfer !== null) {
              adoptTabHere(transfer)
            }
            return
          }
          // The tab may have been dragged in from another column, so this cannot be a change to
          // this column alone — a move has to leave the column it came from at the same time, or
          // the same session ends up open twice.
          dispatch({ type: 'tab/move', key, toColumnId: columnId, toIndex })
        },
      })
    }
    return map
  }, [columnIdsSignature, dispatch, store])
}

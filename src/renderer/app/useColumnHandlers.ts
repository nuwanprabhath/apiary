import { type Dispatch, useEffect, useMemo } from 'react'
import { pruneFoldedPanes } from '../state/composerCollapsed'
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
  /** The tab bar's chevron: fold this pane to its tab bar, or open it again. */
  onFold: (folded: boolean) => void
}

/**
 * Per-column handlers, one set per open column id. Rebuilt only when the set of open column ids
 * changes (a split, a close, a layout change), by keying the memo on the ids themselves rather than
 * the `columns` array reference (which also changes on any tab open/close inside a column).
 */
export function useColumnHandlers(columns: Column[], dispatch: Dispatch<WorkspaceAction>): Map<string, ColumnHandlers> {
  const store = useWorkspaceStore()
  const columnIdsSignature = columns.map((c) => c.id).join(' ')
  // A pane that closed takes its fold with it.
  useEffect(() => { pruneFoldedPanes(columnIdsSignature === '' ? [] : columnIdsSignature.split(' ')) }, [columnIdsSignature])
  return useMemo(() => {
    const map = new Map<string, ColumnHandlers>()
    for (const columnId of columnIdsSignature === '' ? [] : columnIdsSignature.split(' ')) {
      map.set(columnId, {
        onFocus: () => { dispatch({ type: 'column/focus', columnId }) },
        onActivateTab: (key) => { dispatch({ type: 'tab/activate', columnId, key }) },
        onCloseTab: (key) => { dispatch({ type: 'tab/close', columnId, key }) },
        onSetView: (key, view) => { dispatch({ type: 'tab/setView', columnId, key, view }) },
        onFold: (folded) => { dispatch({ type: 'layout/fold', columnId, folded }) },
        onReorderTab: (key, toIndex, transfer) => {
          // Not open anywhere in this window: it came from another one, whose drop the platform
          // delivered here rather than as a `dragend` over nothing (X11 does this). Moving it
          // within this window would do nothing, so ask the main process to hand it over.
          if (findColumnWithTab(store.getState().layout.panes, key) === null) {
            if (transfer !== null) {
              adoptTabHere(transfer)
            }
            return
          }
          // The tab may come from another column; a move leaves that column at the same time, or
          // the same session ends up open twice.
          dispatch({ type: 'tab/move', key, toColumnId: columnId, toIndex })
        },
      })
    }
    return map
  }, [columnIdsSignature, dispatch, store])
}

import { createContext, use, type Dispatch } from 'react'
import type { WorkspaceAction } from './workspaceReducer'
import type { WorkspaceStore } from './workspaceStore'

/**
 * The context carries the store, which never changes identity, so no component re-renders because
 * the workspace did. `useWorkspace()` is the whole state, for the few readers (App's window-level
 * hooks) that need all of it. `layout` and `activeColumnId` stay one value: the reducer writes
 * them together, keeping a split's new pane id and the focus that follows in one update.
 */
export const StoreContext = createContext<WorkspaceStore | null>(null)

/** The store itself, for a callback that must read the state as it is when it runs rather than as
 *  it was when it was created (`store.getState()`), without subscribing to it. */
export function useWorkspaceStore(): WorkspaceStore {
  const store = use(StoreContext)
  if (store === null) throw new Error('useWorkspaceStore outside a WorkspaceProvider')
  return store
}

export function useWorkspaceDispatch(): Dispatch<WorkspaceAction> {
  return useWorkspaceStore().dispatch
}

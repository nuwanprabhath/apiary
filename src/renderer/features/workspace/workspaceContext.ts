import { createContext, use, type Dispatch } from 'react'
import type { WorkspaceAction } from './workspaceReducer'
import type { WorkspaceStore } from './workspaceStore'

/**
 * Owns a window's open tabs, terminals and pane layout: the pure `workspaceReducer` behind a
 * `WorkspaceStore` (review §7.2). The context carries the store, which never changes identity, so
 * no component re-renders because the workspace did. A component reads through
 * `useWorkspaceSelector` and re-renders only when its slice changes; `useWorkspace()` is the whole
 * state, for the few readers (App's window-level hooks) that need all of it. `dispatch` is stable
 * for the provider's life, so a component that only dispatches never re-renders on a change.
 * `layout` and `activeColumnId` stay one value — they are written together by the reducer, which
 * is what keeps a split's new pane id and the focus that follows it in one update.
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

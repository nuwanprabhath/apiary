import { workspaceReducer, type WorkspaceAction, type WorkspaceState } from './workspaceReducer'

/**
 * `dispatch` applies the pure reducer synchronously and in call order, like `useReducer`'s queue,
 * and a listener is told only when the state really changed (returning the same object is a
 * no-op). No React in here: the hook lives in `useWorkspaceSelector.ts`.
 */
export interface WorkspaceStore {
  /** The current state; the same object until a transition changes it. */
  getState: () => WorkspaceState
  /** Stable for the store's life. */
  dispatch: (action: WorkspaceAction) => void
  /** For `useSyncExternalStore`. Returns the unsubscribe. */
  subscribe: (listener: () => void) => () => void
}

export function createWorkspaceStore(
  initial: WorkspaceState,
  reduce: (state: WorkspaceState, action: WorkspaceAction) => WorkspaceState = workspaceReducer,
): WorkspaceStore {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    dispatch: (action) => {
      const next = reduce(state, action)
      if (Object.is(next, state)) return
      state = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

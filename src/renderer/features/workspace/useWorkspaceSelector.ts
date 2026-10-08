import { useRef, useSyncExternalStore } from 'react'
import type { WorkspaceState } from './workspaceReducer'
import { useWorkspaceStore } from './workspaceContext'

/**
 * Reads a slice of the workspace. The component re-renders only when `selector`'s answer changes
 * under `equal` (default `Object.is`), not on every transition — which is what lets a pane's
 * `memo` hold while another pane's tab is activated.
 *
 * `selector` must be pure and return a value that is `equal` for an unchanged slice; a selector
 * that builds a new object or map needs an `equal` for it. It may be an inline function: the
 * previous answer is kept whenever the new one is `equal`, so the snapshot stays stable.
 */
export function useWorkspaceSelector<T>(
  selector: (state: WorkspaceState) => T,
  equal: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useWorkspaceStore()
  const last = useRef<{ state: WorkspaceState; selector: (state: WorkspaceState) => T; value: T } | null>(null)
  const getSnapshot = (): T => {
    const state = store.getState()
    const previous = last.current
    // Same state and same selector: the answer cannot have changed. A new selector (a pane whose
    // tabs changed in the same render that the state did) must be asked again.
    if (previous !== null && previous.state === state && previous.selector === selector) return previous.value
    const value = selector(state)
    const kept = previous !== null && equal(previous.value, value) ? previous.value : value
    last.current = { state, selector, value: kept }
    return kept
  }
  return useSyncExternalStore(store.subscribe, getSnapshot)
}

/** The whole workspace; re-renders on every transition. A pane reads a slice with
 *  `useWorkspaceSelector` instead (`apiary/workspace-via-selector`). */
export function useWorkspace(): WorkspaceState {
  return useWorkspaceSelector((state) => state)
}

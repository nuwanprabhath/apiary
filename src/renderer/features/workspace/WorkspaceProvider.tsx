import {
  createContext, useCallback, use, useMemo, useReducer, type Dispatch, type JSX, type ReactNode,
  type SetStateAction,
} from 'react'
import type { TabTransfer, WindowLayoutReport } from '@shared/types'
import { newColumn } from '../layout/columns'
import { initialLayout, PRESETS, type PresetId } from '../layout/layout'
import {
  workspaceReducer, type TerminalTab, type WorkspaceAction, type WorkspaceState,
} from './workspaceReducer'

/**
 * Owns a window's open tabs, terminals and pane layout as one `useReducer` (UI-1 step 3 / UI-2).
 *
 * Two contexts rather than one: `dispatch` is stable for the provider's life, so a component that
 * only dispatches (every hook in this folder) never re-renders on a state change, while a
 * component that reads takes the state context. `layout` and `activeColumnId` stay one value —
 * they are written together by the reducer, which is what keeps a split's new pane id and the
 * focus that follows it in one update.
 */
const StateContext = createContext<WorkspaceState | null>(null)
const DispatchContext = createContext<Dispatch<WorkspaceAction> | null>(null)

/** The window's starting state: empty, or rebuilt from the previous run's record (`restored`) or
 *  the tab a torn-off window was opened to show (`arrival`). */
export function initWorkspaceState(
  restored: WindowLayoutReport | null,
  arrival: TabTransfer | null,
): WorkspaceState {
  const shellTabs = new Map<string, TerminalTab[]>()
  const activeTerminal = new Map<string, string>()
  for (const pane of restored?.layout.panes ?? []) {
    for (const tab of pane.tabs) {
      if (tab.shells.length > 0) shellTabs.set(tab.key, tab.shells)
      if (tab.activeShell !== null) activeTerminal.set(tab.key, tab.activeShell)
    }
  }
  if (arrival !== null && arrival.shells.length > 0) shellTabs.set(arrival.ptyId ?? arrival.key, arrival.shells)
  if (arrival?.activeShell !== null && arrival?.activeShell !== undefined) {
    activeTerminal.set(arrival.ptyId ?? arrival.key, arrival.activeShell)
  }
  // Sessions started via newSessionInProject()/newSessionInFolder() whose pty id differs from the
  // session's own id; a torn-off window starts out knowing the pty its tab runs under.
  const ptyOverrides = arrival?.ptyId !== null && arrival?.ptyId !== undefined
    ? new Map([[arrival.key, arrival.ptyId]])
    : new Map<string, string>()
  const base = {
    openSessions: new Map(), resumed: new Set<string>(), ptyOverrides, pending: new Map(),
    shellTabs, activeTerminal,
  }
  if (restored === null) return { layout: initialLayout(), activeColumnId: null, ...base }
  // Panes get fresh ids from `newColumn` rather than reusing the persisted ones: `id` is a
  // per-window runtime identity, not something anything on disk needs to stay stable across a
  // restart, and reusing "col-1"/"col-2" verbatim would leave the module's own `nextColumnId`
  // counter at 0, so the very next split would mint "col-1" again and collide with a pane
  // already on screen.
  const panes = restored.layout.panes.map((pane) => ({
    ...newColumn(pane.tabs.map((t) => ({ key: t.key, view: t.view }))),
    activeKey: pane.activeTab,
  }))
  const knownPreset = PRESETS.some((p) => p.id === restored.layout.preset)
  const preset = (knownPreset ? restored.layout.preset : 'single') as PresetId
  return { ...base, layout: { preset, panes }, activeColumnId: panes[0]?.id ?? null }
}

export function WorkspaceProvider({ restored, arrival, children }: {
  restored: WindowLayoutReport | null
  arrival: TabTransfer | null
  children: ReactNode
}): JSX.Element {
  const [state, dispatch] = useReducer(workspaceReducer, undefined, () => initWorkspaceState(restored, arrival))
  return (
    <DispatchContext value={dispatch}>
      <StateContext value={state}>{children}</StateContext>
    </DispatchContext>
  )
}

export function useWorkspace(): WorkspaceState {
  const state = use(StateContext)
  if (state === null) throw new Error('useWorkspace outside a WorkspaceProvider')
  return state
}

export function useWorkspaceDispatch(): Dispatch<WorkspaceAction> {
  const dispatch = use(DispatchContext)
  if (dispatch === null) throw new Error('useWorkspaceDispatch outside a WorkspaceProvider')
  return dispatch
}

/** The shell-tab and active-terminal maps' setters in the `useState` shape `SessionColumn` was
 *  written against; stable, and each one a single reducer action. */
export function useShellSetters(): {
  setShellTabs: Dispatch<SetStateAction<Map<string, TerminalTab[]>>>
  setActiveTerminal: Dispatch<SetStateAction<Map<string, string>>>
} {
  const dispatch = useWorkspaceDispatch()
  const setShellTabs = useCallback((u: SetStateAction<Map<string, TerminalTab[]>>) => {
    dispatch({ type: 'shellTabs/update', update: typeof u === 'function' ? u : () => u })
  }, [dispatch])
  const setActiveTerminal = useCallback((u: SetStateAction<Map<string, string>>) => {
    dispatch({ type: 'activeTerminal/update', update: typeof u === 'function' ? u : () => u })
  }, [dispatch])
  return useMemo(() => ({ setShellTabs, setActiveTerminal }), [setShellTabs, setActiveTerminal])
}

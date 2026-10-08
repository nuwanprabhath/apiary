/**
 * What the rest of the renderer may import from the workspace feature: the selector hook a pane
 * reads its slice with, the setters it writes shells through, and the state types. The store, the
 * reducer and the window-level effect hooks are the workspace's own.
 */
export { useWorkspaceSelector } from './useWorkspaceSelector'
export { useShellSetters } from './WorkspaceProvider'
export type { TerminalTab, WorkspaceState } from './workspaceReducer'
export { ptyKeyOf, sessionIdOfTabKey } from './ptyKey'

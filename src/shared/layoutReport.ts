import type { TabView } from './domain/tabs'
import type { PersistedLayout } from './types'

/**
 * The structural subset of the renderer's `Layout`/`Column`/`OpenTab` (`renderer/state/layout.ts`,
 * `renderer/state/columns.ts`) that `buildPersistedLayout` needs.
 *
 * Named here rather than importing the renderer types, because `tsconfig.node.json` has no DOM
 * lib. The renderer's real `Layout` satisfies this shape structurally.
 */
export interface LayoutLike {
  preset: string
  panes: {
    id: string
    tabs: { key: string; view: TabView }[]
    activeKey: string | null
    collapsed?: boolean
  }[]
}

/**
 * Walks a window's live layout state into the plain shape `reportLayout` sends to main.
 */
export function buildPersistedLayout(
  layout: LayoutLike,
  shellTabs: Map<string, { id: string; name: string }[]>,
  activeTerminal: Map<string, string>,
  ptyOverrides: Map<string, string>,
): PersistedLayout {
  return {
    preset: layout.preset,
    panes: layout.panes.map((pane) => ({
      id: pane.id,
      activeTab: pane.activeKey,
      // Only a folded pane says so.
      ...(pane.collapsed === true ? { collapsed: true } : {}),
      tabs: pane.tabs.map((tab) => {
        // A pending session is keyed by its session id in the layout, but its shells hang off the pty id it started under.
        const shellKey = ptyOverrides.get(tab.key) ?? tab.key
        return {
          key: tab.key,
          view: tab.view,
          shells: shellTabs.get(shellKey) ?? [],
          activeShell: activeTerminal.get(shellKey) ?? null,
        }
      }),
    })),
  }
}

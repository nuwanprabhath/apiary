import type { PersistedLayout } from './types'

/**
 * The structural subset of the renderer's `Layout`/`Column`/`OpenTab` (`renderer/state/layout.ts`,
 * `renderer/state/columns.ts`) that `buildPersistedLayout` needs.
 *
 * Named separately here, rather than importing those renderer types, because `tsconfig.node.json`
 * has no DOM lib — a shared file that imported renderer state would drag renderer code into main's
 * tsconfig project the same way pulling `PresetId` in here would (see `PersistedLayout`'s own
 * comment in `types.ts`). TypeScript's structural typing means the renderer's real `Layout` value
 * satisfies this shape unchanged, so `App.tsx` passes it straight through.
 */
export interface LayoutLike {
  preset: string
  panes: {
    id: string
    tabs: { key: string; view: 'transcript' | 'terminal' }[]
    activeKey: string | null
  }[]
}

/**
 * Walks a window's live layout state into the plain shape `reportLayout` sends to main.
 *
 * Lives here, not in `App.tsx`, so a later task that needs this window's open tabs from the main
 * process (see `WindowLayoutRecord`'s restore path) can call the exact same walker instead of
 * writing a second one that can drift from it — `src/main/` can import this file, but never
 * `src/renderer/`'s.
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
      tabs: pane.tabs.map((tab) => {
        // A pending session is keyed by its real (or eventual) session id in the layout, but its
        // shells hang off the pty id it actually started under — see `ptyOverrides`'s own comment.
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

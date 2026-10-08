import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { PluginBarItemPayload } from '@shared/api'
import type { TerminalRef } from '@shared/domain/ids'
import { MergeRequestIcon, LinkIcon, PlusIcon, AlertIcon } from '../../ui/icons'
import type { ToolbarButtonSpec } from './Toolbar'
import { onPluginsChanged, readPluginBar, refreshPluginBar, runPluginAction } from '../../state/plugins'

/**
 * The renderer's half of the session-bar plugins.
 *
 * A plugin describes a button; this turns that description into one. The mapping from an icon
 * *name* to an actual glyph lives here and nowhere else — the main process never sends markup, so
 * a plugin cannot put arbitrary content in the window, only choose from what this file knows how
 * to draw.
 */

const ICONS: Record<PluginBarItemPayload['icon'], JSX.Element> = {
  'merge-request': <MergeRequestIcon />,
  'merge-request-merged': <MergeRequestIcon state="merged" />,
  'merge-request-closed': <MergeRequestIcon state="closed" />,
  link: <LinkIcon />,
  plus: <PlusIcon />,
  alert: <AlertIcon />,
}

/**
 * Keeps one session's plugin buttons up to date.
 *
 * Re-asked whenever the session or its branch changes — a branch switch is the event that changes
 * which merge request is the relevant one — and whenever the main process says a background lookup
 * came back with something different.
 */
export function usePluginBar(terminal: TerminalRef | null, branch: string | null): {
  items: PluginBarItemPayload[]
  refresh: () => void
} {
  const [items, setItems] = useState<PluginBarItemPayload[]>([])
  /** Which tab's request is the current one, so a slower response for a tab left behind cannot
   *  put its plugin buttons (e.g. its merge request) on the tab now in front (UI-14). */
  const requestKey = useRef<string | null>(null)

  const load = useCallback(() => {
    if (terminal === null) { setItems([]); return }
    requestKey.current = terminal.id
    // A plugin bar that cannot be read is an empty plugin bar (see `readPluginBar`).
    void readPluginBar(terminal).then((result) => { if (requestKey.current === terminal.id) setItems(result ?? []) })
  }, [terminal])

  useEffect(load, [load, branch])
  useEffect(() => onPluginsChanged(load), [load])

  const refresh = useCallback(() => {
    if (terminal === null) return
    requestKey.current = terminal.id
    void refreshPluginBar(terminal).then((result) => { if (requestKey.current === terminal.id && result !== null) setItems(result) })
  }, [terminal])

  return { items, refresh }
}

/** Turns plugin descriptions into toolbar buttons. */
export function pluginButtons(items: PluginBarItemPayload[]): ToolbarButtonSpec[] {
  return items.map((item) => ({
    id: `plugin:${item.pluginId}:${item.id}`,
    icon: ICONS[item.icon] ?? <LinkIcon />,
    label: item.label,
    title: item.title,
    testId: `plugin-${item.pluginId}-${item.id}`,
    tone: item.tone,
    onClick: () => {
      if (item.action.kind === 'none') return
      runPluginAction(item)
    },
  }))
}

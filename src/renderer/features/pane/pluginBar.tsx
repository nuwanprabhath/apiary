import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { PluginBarItemPayload } from '@shared/api'
import type { TerminalRef } from '@shared/domain/ids'
import { MergeRequestIcon, LinkIcon, PlusIcon, AlertIcon } from '../../ui/icons'
import type { ToolbarButtonSpec } from './Toolbar'
import { onPluginsChanged, readPluginBar, refreshPluginBar, runPluginAction } from '../../state/plugins'

// Main never sends markup: a plugin can only choose from the icons this file knows how to draw.

const ICONS: Record<PluginBarItemPayload['icon'], JSX.Element> = {
  'merge-request': <MergeRequestIcon />,
  'merge-request-merged': <MergeRequestIcon state="merged" />,
  'merge-request-closed': <MergeRequestIcon state="closed" />,
  link: <LinkIcon />,
  plus: <PlusIcon />,
  alert: <AlertIcon />,
}

/** Re-asked when the session or branch changes (which decides the relevant merge request) and when
 *  a background lookup in main came back different. */
export function usePluginBar(terminal: TerminalRef | null, branch: string | null): {
  items: PluginBarItemPayload[]
  refresh: () => void
} {
  const [items, setItems] = useState<PluginBarItemPayload[]>([])
  // A slower response for a tab left behind must not put its buttons on the tab in front.
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

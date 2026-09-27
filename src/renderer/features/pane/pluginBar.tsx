import { type JSX, useCallback, useEffect, useRef, useState } from 'react'
import type { PluginBarItemPayload } from '@shared/api'
import { MergeRequestIcon, LinkIcon, PlusIcon, AlertIcon } from '../../ui/icons'
import type { ToolbarButtonSpec } from './Toolbar'

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
export function usePluginBar(key: string | null, isPtyId: boolean, branch: string | null): {
  items: PluginBarItemPayload[]
  refresh: () => void
} {
  const [items, setItems] = useState<PluginBarItemPayload[]>([])
  /** Which tab's request is the current one, so a slower response for a tab left behind cannot
   *  put its plugin buttons (e.g. its merge request) on the tab now in front (UI-14). */
  const requestKey = useRef<string | null>(null)

  const load = useCallback(() => {
    if (key === null) { setItems([]); return }
    requestKey.current = key
    void window.apiary.pluginBarItems(key, isPtyId)
      .then((result) => { if (requestKey.current === key) setItems(result) })
      // A plugin bar that cannot be read is an empty plugin bar, never an error in front of the
      // session: nothing here is load-bearing.
      .catch(() => { if (requestKey.current === key) setItems([]) })
  }, [key, isPtyId])

  useEffect(load, [load, branch])
  useEffect(() => window.apiary.onPluginsChanged(load), [load])

  const refresh = useCallback(() => {
    if (key === null) return
    requestKey.current = key
    void window.apiary.pluginBarRefresh(key, isPtyId)
      .then((result) => { if (requestKey.current === key) setItems(result) })
      .catch(() => { /* as above */ })
  }, [key, isPtyId])

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
      void window.apiary.pluginRunAction(item)
    },
  }))
}

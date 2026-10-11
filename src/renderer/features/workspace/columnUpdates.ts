import { type Column } from '../../state/columns'
import { tidyLayout, type Layout } from '../../state/layout'
import type { WorkspaceState } from './workspaceTypes'

/** The column an action aimed at `preferred` lands in: that one if it is still open, else the first. */
export function targetColumnId(state: WorkspaceState, preferred?: string): string | undefined {
  const columns = state.layout.panes
  if (preferred !== undefined && columns.some((c) => c.id === preferred)) return preferred
  return columns[0]?.id
}

export function updateColumns(layout: Layout, activeColumnId: string | null, fn: (c: Column) => Column): Layout {
  return tidyLayout({ ...layout, panes: layout.panes.map(fn) }, activeColumnId)
}

export function dropKey<K, V>(map: Map<K, V>, key: K): Map<K, V> {
  const next = new Map(map)
  next.delete(key)
  return next
}

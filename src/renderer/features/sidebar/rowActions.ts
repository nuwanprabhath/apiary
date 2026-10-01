import type { SessionNode } from '@shared/types'

/**
 * What every session row in every section can do — one object, so a section takes one prop for it
 * instead of seven, and `Sidebar` can keep it referentially stable across unrelated renders.
 */
export interface RowActions {
  onSelect: (session: SessionNode) => void
  onSplit: (session: SessionNode) => void
  onDelete: (session: SessionNode) => void
  onTogglePin: (session: SessionNode) => void
  onEditNote: (session: SessionNode) => void
  /** Right-click or the keyboard's menu key; the menu itself belongs to the sidebar. */
  onMenu: (session: SessionNode, x: number, y: number) => void
}

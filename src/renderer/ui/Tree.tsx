/**
 * WAI-ARIA tree keyboard helpers for every tree-shaped list in the sidebar (a flat list is a tree
 * with every item at level 1).
 *
 * Reads the DOM rather than keeping parallel parent/child bookkeeping: levels come from
 * `aria-level`, and a collapsed branch's children are never mounted, so DOM order of rendered
 * `[role="treeitem"]`s is the visible order.
 */
import { useRef, useState, type RefObject } from 'react'

function treeItemsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')]
}

function levelOf(el: HTMLElement): number {
  const raw = el.getAttribute('aria-level')
  return raw === null ? 1 : Number(raw)
}

export interface TreeKeyHandlers {
  onEnter?: (current: HTMLElement) => void
  /** Sessions: open beside the current one. */
  onShiftEnter?: (current: HTMLElement) => void
  /**
   * `movedToChild` false means the item is a collapsed branch or a leaf, which decides what
   * "right" means for it (expand, or nothing).
   */
  onArrowRight?: (current: HTMLElement, movedToChild: boolean) => void
  onArrowLeft?: (current: HTMLElement, hasParent: boolean) => void
  /** Shift+F10 or the Menu key: how the row-action buttons hidden from Tab are reached. */
  onContextMenuKey?: (current: HTMLElement, at: { x: number; y: number }) => void
}

/** One `onKeyDown` on a tree's root handles the whole pattern: arrows, Home/End, Enter, context menu. */
export function onTreeKeyDown(e: React.KeyboardEvent, root: HTMLElement, handlers: TreeKeyHandlers): void {
  const items = treeItemsIn(root)
  if (items.length === 0) return
  const idx = items.indexOf(document.activeElement as HTMLElement)
  const current = idx === -1 ? null : items[idx]

  switch (e.key) {
    case 'ArrowDown':
      e.preventDefault()
      items[idx === -1 ? 0 : Math.min(idx + 1, items.length - 1)]?.focus()
      return
    case 'ArrowUp':
      e.preventDefault()
      items[idx === -1 ? items.length - 1 : Math.max(idx - 1, 0)]?.focus()
      return
    case 'Home':
      e.preventDefault()
      items[0]?.focus()
      return
    case 'End':
      e.preventDefault()
      items[items.length - 1]?.focus()
      return
    case 'ArrowRight': {
      if (current === null) return
      e.preventDefault()
      // The next item is the first child exactly when it is one level deeper.
      const next = items[idx + 1]
      const isChild = next !== undefined && levelOf(next) > levelOf(current)
      if (isChild) next.focus()
      handlers.onArrowRight?.(current, isChild)
      return
    }
    case 'ArrowLeft': {
      if (current === null) return
      e.preventDefault()
      const curLevel = levelOf(current)
      let parent: HTMLElement | undefined
      for (let i = idx - 1; i >= 0; i--) {
        if (levelOf(items[i]) < curLevel) { parent = items[i]; break }
      }
      if (parent !== undefined) parent.focus()
      handlers.onArrowLeft?.(current, parent !== undefined)
      return
    }
    case 'Enter':
      if (current === null) return
      e.preventDefault()
      if (e.shiftKey) handlers.onShiftEnter?.(current)
      else handlers.onEnter?.(current)
      return
    case 'ContextMenu':
      if (current === null || handlers.onContextMenuKey === undefined) return
      e.preventDefault()
      handlers.onContextMenuKey(current, contextMenuPoint(current))
      return
    case 'F10':
      if (!e.shiftKey || current === null || handlers.onContextMenuKey === undefined) return
      e.preventDefault()
      handlers.onContextMenuKey(current, contextMenuPoint(current))
      return
    default:
      return
  }
}

/** Where a keyboard-opened context menu appears: at the row, not the pointer. */
function contextMenuPoint(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: r.left + 8, y: r.bottom }
}

/** The tree's one Tab stop (by `data-tree-key`): `fallbackKey` until a focus event names another. */
export function rovingTabIndex(focusKey: string | null, fallbackKey: string | null, key: string): number {
  return (focusKey ?? fallbackKey) === key ? 0 : -1
}

/** Roving-tabindex and keyboard wiring for a *flat* tree (Active, Pinned, Recent, search results): every row is level 1. */
export function useFlatTreeNav<E extends HTMLElement = HTMLDivElement>(
  keys: string[],
  handlers: TreeKeyHandlers,
): {
  ref: RefObject<E | null>
  onKeyDown: (e: React.KeyboardEvent) => void
  onFocus: (e: React.FocusEvent) => void
  tabIndexFor: (key: string) => number
} {
  const ref = useRef<E>(null)
  const [focusKey, setFocusKey] = useState<string | null>(null)
  return {
    ref,
    onFocus: (e) => {
      const item = (e.target as HTMLElement).closest('[role="treeitem"]')
      const key = item?.getAttribute('data-tree-key') ?? null
      if (key !== null) setFocusKey(key)
    },
    onKeyDown: (e) => { if (ref.current !== null) onTreeKeyDown(e, ref.current, handlers) },
    tabIndexFor: (key) => rovingTabIndex(focusKey, keys[0] ?? null, key),
  }
}

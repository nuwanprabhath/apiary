/**
 * WAI-ARIA tree keyboard helpers, shared by every tree-shaped list in the sidebar (the folder and
 * session hierarchy, and the flatter Active/Pinned/Recent sections and search results — a flat
 * list is a legal tree with every item at level 1).
 *
 * The pattern mirrors `ui/Menu.tsx`'s: read the DOM rather than keep a parallel data structure, so
 * a tree that nests groups inside groups inside folders inside sessions doesn't need matching
 * parent/child bookkeeping in JS. Levels are compared through `aria-level`, which every row
 * already carries for assistive tech, so "first child" and "parent" fall out of it for free:
 * a collapsed branch's children are never mounted at all (`SessionTree` only renders them when
 * open), so the DOM order among rendered `[role="treeitem"]`s already *is* the visible order.
 */
import { useRef, useState, type RefObject } from 'react'

export function treeItemsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[role="treeitem"]')]
}

/** aria-level as a number, defaulting to 1 (a flat list's implicit level) if unset. */
function levelOf(el: HTMLElement): number {
  const raw = el.getAttribute('aria-level')
  return raw === null ? 1 : Number(raw)
}

export interface TreeKeyHandlers {
  /** Enter on the focused item. */
  onEnter?: (current: HTMLElement) => void
  /** Shift+Enter on the focused item (sessions: open beside the current one). */
  onShiftEnter?: (current: HTMLElement) => void
  /**
   * ArrowRight on the focused item. Given the item and whether the caller found and focused a
   * first child for it — if not, the item is a collapsed branch or a leaf, and gets to decide
   * what "right" means for it (expand, or nothing).
   */
  onArrowRight?: (current: HTMLElement, movedToChild: boolean) => void
  /** ArrowLeft on the focused item, once a parent to move to has already been ruled out. */
  onArrowLeft?: (current: HTMLElement, hasParent: boolean) => void
  /** The row-action buttons a session or folder row hides from Tab (UI-27 step 1) are reached
   *  this way instead: Shift+F10 or the Menu key, same as everywhere else in the app. */
  onContextMenuKey?: (current: HTMLElement, at: { x: number; y: number }) => void
}

/**
 * Up/Down/Home/End move focus among a tree's items; Left/Right and Enter are hosted here too
 * (rather than split into a second function) so a single `onKeyDown` on a tree's root handles the
 * whole pattern the same way `ui/Menu.tsx` does for menus.
 */
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
      // The next item in the flat list is the first child exactly when it is one level deeper —
      // nesting means it was rendered right after its parent, and nothing else can sit between
      // them without itself being at the parent's level or shallower.
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

/** Where a keyboard-opened context menu appears: the row's own top-left, like right-clicking
 *  its label rather than wherever the pointer last happened to be. */
function contextMenuPoint(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return { x: r.left + 8, y: r.bottom }
}

/**
 * A tree's roving-tabindex state: which item (by its `data-tree-key`) is the tree's one Tab stop.
 * Defaults to `fallbackKey` (the first item, computed from data the caller already has — no DOM
 * query needed for it) until a real focus event names a different one, exactly like a browser's
 * own roving tabindex once the user has moved through the tree at all.
 */
export function rovingTabIndex(focusKey: string | null, fallbackKey: string | null, key: string): number {
  return (focusKey ?? fallbackKey) === key ? 0 : -1
}

/**
 * The whole roving-tabindex + keyboard wiring for a *flat* tree — Active, Pinned, Recent and the
 * flat search-results list, none of which nest anything, so every row is level 1 and Left/Right
 * have no expand/collapse work to do (a leaf's `onArrowRight`/`onArrowLeft` simply see there is no
 * child or parent to move to and stop there, per `onTreeKeyDown`). One hook covers all four
 * sections identically instead of repeating the same `ref`/`useState`/`onKeyDown` three more times.
 */
export function useFlatTreeNav<E extends HTMLElement = HTMLDivElement>(
  keys: string[],
  handlers: TreeKeyHandlers,
): {
  ref: RefObject<E>
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

import { type RefObject, useLayoutEffect } from 'react'

const ITEM_SELECTOR = '[role="menuitem"]:not([disabled]), [role="menuitemcheckbox"]:not([disabled])'

/**
 * Every enabled menu item that belongs to `root`'s own level, in DOM order — not a descendant
 * submenu's.
 *
 * `GitMenu`'s submenu is a nested `<ul role="menu">` inside the parent item's `<li>`, so a plain
 * `querySelectorAll` rooted at the outer `<ul>` would also return a *closed* submenu's items, and
 * Up/Down at the top level would silently start visiting them. Filtering to items whose nearest
 * `[role="menu"]` ancestor is `root` itself keeps each level's roving focus scoped to what is
 * actually showing.
 */
export function itemsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)]
    .filter((el) => el.closest('[role="menu"]') === root)
}

/**
 * Focuses the first enabled item in `root` once `enabled` becomes true, and restores focus to
 * whatever had it beforehand once `enabled` goes false again (the menu closing, however that
 * happens). A layout effect, like `Modal`'s initial-focus effect, so focus lands before the first
 * paint the menu is visible in.
 */
export function useMenuOpenFocus(root: RefObject<HTMLElement | null>, enabled: boolean): void {
  useLayoutEffect(() => {
    if (!enabled) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const node = root.current
    if (node !== null) itemsIn(node)[0]?.focus()
    return () => { previouslyFocused?.focus() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per open, like Modal's.
  }, [enabled])
}

/**
 * ArrowUp/ArrowDown/Home/End among the items directly inside `root` — the roving-focus part of the
 * WAI-ARIA menu pattern. A plain function rather than a hook, so a caller with more than one level
 * of items open at once (`GitMenu`'s submenu) can call it once per level, each scoped to its own
 * `<ul>`, and add ArrowRight/ArrowLeft for moving between levels itself: there is no one `root` a
 * hook could bind to that would mean "whichever list currently has focus."
 */
export function onMenuKeyDown(e: React.KeyboardEvent, root: HTMLElement): void {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const items = itemsIn(root)
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  let next: number
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = items.length - 1
  else if (e.key === 'ArrowDown') next = current === -1 ? 0 : (current + 1) % items.length
  else next = current === -1 ? items.length - 1 : (current - 1 + items.length) % items.length
  e.preventDefault()
  e.stopPropagation()
  items[next]?.focus()
}

/**
 * The combination `ContextMenu` needs: a flat, single-level menu with no submenus, so open-focus
 * and arrow navigation both scope to the same `root`.
 */
export function useMenuNav(root: RefObject<HTMLElement | null>, enabled: boolean): {
  onKeyDown: (e: React.KeyboardEvent) => void
} {
  useMenuOpenFocus(root, enabled)
  return {
    onKeyDown: (e) => { if (root.current !== null) onMenuKeyDown(e, root.current) },
  }
}

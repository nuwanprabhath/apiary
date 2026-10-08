import { createElement, type HTMLAttributes, type JSX, type KeyboardEvent, type Ref, type RefObject, useCallback, useLayoutEffect, useRef } from 'react'
import { rovingKeyDown } from './useRovingList'

const ITEM_SELECTOR = ['menuitem', 'menuitemcheckbox', 'menuitemradio'].map((role) => `[role="${role}"]:not([disabled])`).join(', ')

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
function useMenuOpenFocus(root: RefObject<HTMLElement | null>, enabled: boolean): void {
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
function onMenuKeyDown(e: React.KeyboardEvent, root: HTMLElement): void {
  if (rovingKeyDown(e, itemsIn(root), { wrap: true })) e.stopPropagation()
}

type MenuProps = Omit<HTMLAttributes<HTMLElement>, 'role'> & {
  /** The element to render: a `ul` for a list of `li`s, a `div` otherwise. */
  as?: 'div' | 'ul'
  ref?: Ref<HTMLElement>
  testId?: string
  /** Focus the first item on mount and give focus back on unmount. Default true; off for a menu
   *  that is mounted before it can take focus (hidden while it is measured) and does it itself. */
  focusOnOpen?: boolean
}

/**
 * A `role="menu"` with the keyboard contract that role promises: it takes focus when it opens
 * (first item), ArrowUp/ArrowDown/Home/End move between its items — menuitem, menuitemcheckbox and
 * menuitemradio — and focus goes back to where it was when it closes. Escape and outside clicks
 * stay with the owner (`useEscape`, `useOutsideDismiss`).
 *
 * A caller's own `onKeyDown` runs first; if it calls `preventDefault` the default keys step aside
 * (a submenu's ArrowLeft, say). Left/Right between menus is the owner's to add.
 */
export function Menu({ as = 'div', ref, testId, focusOnOpen = true, onKeyDown, ...rest }: MenuProps): JSX.Element {
  const own = useRef<HTMLElement | null>(null)
  useMenuOpenFocus(own, focusOnOpen)
  const setRef = useCallback((node: HTMLElement | null) => {
    own.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref !== undefined && ref !== null) ref.current = node
  }, [ref])
  return createElement(as, {
    role: 'menu',
    'data-testid': testId,
    ref: setRef,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      onKeyDown?.(e)
      if (!e.defaultPrevented && own.current !== null) onMenuKeyDown(e, own.current)
    },
    ...rest,
  })
}


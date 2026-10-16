import { createElement, type HTMLAttributes, type JSX, type KeyboardEvent, type Ref, type RefObject, useCallback, useLayoutEffect, useRef } from 'react'
import { rovingKeyDown } from './useRovingList'

const ITEM_SELECTOR = ['menuitem', 'menuitemcheckbox', 'menuitemradio'].map((role) => `[role="${role}"]:not([disabled])`).join(', ')

/**
 * Every enabled item at `root`'s own level, not a descendant submenu's: `GitMenu`'s submenu is a
 * nested `<ul role="menu">`, and a plain `querySelectorAll` would also return a *closed*
 * submenu's items.
 */
export function itemsIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)]
    .filter((el) => el.closest('[role="menu"]') === root)
}

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

function onMenuKeyDown(e: React.KeyboardEvent, root: HTMLElement): void {
  if (rovingKeyDown(e, itemsIn(root), { wrap: true })) e.stopPropagation()
}

type MenuProps = Omit<HTMLAttributes<HTMLElement>, 'role'> & {
  as?: 'div' | 'ul'
  ref?: Ref<HTMLElement>
  testId?: string
  /** Off for a menu mounted before it can take focus (hidden while measured), which does it itself. */
  focusOnOpen?: boolean
}

/**
 * A `role="menu"` with its keyboard contract: focus on open and back on close, arrows/Home/End
 * between items. Escape and outside clicks stay with the owner (`useEscape`, `useOutsideDismiss`).
 *
 * A caller's own `onKeyDown` runs first; `preventDefault` there makes the default keys step aside.
 */
export function Menu({ as = 'div', ref, testId, focusOnOpen = true, onKeyDown, className, ...rest }: MenuProps): JSX.Element {
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
    className: className === undefined ? 'context-menu' : `context-menu ${className}`,
  })
}


import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscape } from './useEscape'
import { useMenuNav } from './Menu'
import { CheckIcon } from './icons'

export interface ContextMenuItem {
  id: string
  label: string
  run: () => void
  disabled?: boolean
  /** Starts a new visual group above this item, for separating unlike actions. */
  separator?: boolean
  /** Why the item is unavailable, shown on hover. A greyed-out item with no reason given reads as
   *  broken rather than as "not yet". */
  disabledReason?: string
  /** Makes the item a toggle, drawn with a tick while it is on. */
  checked?: boolean
}

interface Props {
  items: ContextMenuItem[]
  /** Where the right-click happened, in viewport coordinates. Null closes the menu. */
  position: { x: number; y: number } | null
  onClose: () => void
  testId?: string
}

/**
 * The one right-click menu, shared by the tab strip, the terminal and the sidebar.
 *
 * Fixed to the viewport rather than positioned within its opener, so it is never clipped by the
 * scrolling or overflow of whatever it was opened from — the tab strip scrolls horizontally and the
 * sidebar vertically, and a menu that disappeared into either would be useless.
 *
 * Portalled to the body for the same reason one level up: fixed positioning escapes overflow but
 * not a stacking context, and glass isolates each panel into one (`isolation: isolate`). Drawn
 * inside the sidebar, the menu's z-index counted only within it, and the session pane beside it
 * painted over whatever part of the menu reached across.
 */
export function ContextMenu({ items, position, onClose, testId }: Props): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement | null>(null)

  /**
   * Nudged back on screen when opened near an edge.
   *
   * Measured after rendering at the requested point, not before: the menu has no size until it is
   * in the document, so gating the render on having measured it would mean never rendering it at
   * all. A layout effect corrects it before the browser paints, so this reads as one position
   * rather than a visible jump.
   */
  const [nudge, setNudge] = useState<{ top: number; left: number } | null>(null)
  useLayoutEffect(() => {
    if (position === null || rootRef.current === null) {
      setNudge(null)
      return
    }
    const rect = rootRef.current.getBoundingClientRect()
    const left = position.x + rect.width > window.innerWidth
      ? Math.max(0, window.innerWidth - rect.width - 4)
      : position.x
    const top = position.y + rect.height > window.innerHeight
      ? Math.max(0, window.innerHeight - rect.height - 4)
      : position.y
    setNudge(left === position.x && top === position.y ? null : { top, left })
  }, [position])

  // Escape closes it via the shared stack (UI-13) — only the top-most open layer reacts, so a
  // context menu opened from inside another popup doesn't also close that popup. A press anywhere
  // outside is still handled here directly.
  useEscape(onClose, { enabled: position !== null })
  // UI-26: focuses the first item on open, arrow/Home/End between items, restores focus to
  // whatever opened the menu on close.
  const { onKeyDown } = useMenuNav(rootRef, position !== null)
  useEffect(() => {
    if (position === null) return
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current?.contains(e.target as Node) !== true) onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { document.removeEventListener('mousedown', onPointerDown) }
  }, [position, onClose])

  if (position === null) return null

  return createPortal(
    <div
      className="context-menu"
      data-testid={testId ?? 'context-menu'}
      role="menu"
      ref={rootRef}
      style={{ top: nudge?.top ?? position.y, left: nudge?.left ?? position.x }}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.id}
          className="context-menu-item"
          data-testid={`context-menu-${item.id}`}
          data-separator={item.separator === true}
          role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
          aria-checked={item.checked}
          disabled={item.disabled ?? false}
          title={item.disabled === true ? item.disabledReason : undefined}
          onClick={() => { item.run(); onClose() }}
        >
          {/* UI-32: reuses icons.tsx's CheckIcon (its `on` prop sets the `data-on` this rule keys
           *  off) instead of duplicating the same path inline. */}
          {item.checked !== undefined && <CheckIcon className="context-menu-check" on={item.checked} />}
          {item.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}

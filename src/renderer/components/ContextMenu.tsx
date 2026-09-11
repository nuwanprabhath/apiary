import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  id: string
  label: string
  run: () => void
  disabled?: boolean
  /** Starts a new visual group above this item, for separating unlike actions. */
  separator?: boolean
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

  // Escape, or a press anywhere outside, closes it — bound only while open.
  useEffect(() => {
    if (position === null) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current?.contains(e.target as Node) !== true) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [position, onClose])

  if (position === null) return null

  return (
    <div
      className="context-menu"
      data-testid={testId ?? 'context-menu'}
      role="menu"
      ref={rootRef}
      style={{ top: nudge?.top ?? position.y, left: nudge?.left ?? position.x }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          className="context-menu-item"
          data-testid={`context-menu-${item.id}`}
          data-separator={item.separator === true}
          role="menuitem"
          disabled={item.disabled ?? false}
          onClick={() => { item.run(); onClose() }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

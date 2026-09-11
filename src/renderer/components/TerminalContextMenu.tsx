import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface TerminalContextMenuItem {
  id: string
  label: string
  run?: () => void
  disabled?: boolean
}

interface Props {
  items: TerminalContextMenuItem[]
  onClose: () => void
  position: { x: number; y: number } | null
}

/**
 * Right-click context menu for the terminal. Positioned `fixed` so it can appear outside the
 * terminal container's overflow bounds, much like the git menu. Dismissed by Escape, a click
 * anywhere outside, or running any command.
 */
export function TerminalContextMenu({ items, onClose, position }: Props): JSX.Element | null {
  const rootRef = useRef<HTMLDivElement | null>(null)

  /**
   * Nudged back on screen when the cursor is near an edge.
   *
   * Measured after rendering at the requested point, not before: the menu has no size until it is
   * in the document, so gating the render on having measured it would mean never rendering it at
   * all. It is drawn where asked, then corrected in the same frame via a layout effect, which the
   * browser paints as one position rather than a visible jump.
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

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    // mousedown captures clicks that land outside the menu
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current?.contains(e.target as Node) === true) return
      onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('mousedown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('mousedown', onPointerDown)
    }
  }, [onClose])

  if (position === null) return null

  return (
    <div
      className="terminal-context-menu-root"
      ref={rootRef}
      style={{ top: nudge?.top ?? position.y, left: nudge?.left ?? position.x }}
    >
      <ul className="terminal-context-menu" role="menu">
        {items.map((item) => (
          <li key={item.id}>
            <button
              className="terminal-context-menu-item"
              disabled={item.disabled ?? false}
              onClick={() => {
                item.run?.()
                onClose()
              }}
            >
              {item.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

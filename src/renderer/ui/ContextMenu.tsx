import { type CSSProperties, type JSX, type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useEscape } from './useEscape'
import { useOutsideDismiss } from './useOutsideDismiss'
import { itemsIn, Menu } from './Menu'
import { CheckIcon, SubmenuArrowIcon } from './icons'
import type { ContextMenuItem } from './contextMenuItem'

interface Props {
  items: ContextMenuItem[]
  /** Where the right-click happened, in viewport coordinates. Null closes the menu. */
  position: { x: number; y: number } | null
  onClose: () => void
  testId?: string
  /** Whether the menu takes focus when it opens. Off for a menu opened beside a text field the user
   *  is still typing in, which has to keep its caret. */
  focusOnOpen?: boolean
}

/**
 * The one right-click menu, shared by the tab strip, the terminal, the sidebar and the text menus.
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
export function ContextMenu({ items, position, onClose, testId, focusOnOpen = true }: Props): JSX.Element | null {
  const rootRef = useRef<HTMLElement | null>(null)

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
  useOutsideDismiss(onClose, { enabled: position !== null, inside: [rootRef] })

  if (position === null) return null

  return createPortal(
    <ContextMenuPanel
      items={items}
      onClose={onClose}
      testId={testId ?? 'context-menu'}
      focusOnOpen={focusOnOpen}
      rootRef={rootRef}
      style={{ top: nudge?.top ?? position.y, left: nudge?.left ?? position.x }}
    />,
    document.body,
  )
}

interface PanelProps {
  items: ContextMenuItem[]
  onClose: () => void
  testId: string
  focusOnOpen: boolean
  rootRef: RefObject<HTMLElement | null>
  style: CSSProperties
}

/** Holds which submenu is open, so it starts closed each time the menu opens. */
function ContextMenuPanel({ items, onClose, testId, focusOnOpen, rootRef, style }: PanelProps): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  // UI-26: `Menu` focuses the first item on open, steps with arrow/Home/End and restores focus
  // to whatever opened the menu on close.
  return (
    <Menu className="context-menu-floating" testId={testId} ref={rootRef} focusOnOpen={focusOnOpen} style={style}>
      {items.map((item) => (
        <ContextMenuEntry key={item.id} item={item} open={openId === item.id} onOpen={setOpenId} onClose={onClose} />
      ))}
    </Menu>
  )
}

interface EntryProps {
  item: ContextMenuItem
  open: boolean
  onOpen: (id: string | null) => void
  onClose: () => void
}

function ContextMenuEntry({ item, open, onOpen, onClose }: EntryProps): JSX.Element {
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const flyoutRef = useRef<HTMLElement | null>(null)
  const [flipped, setFlipped] = useState(false)
  const submenu = item.submenu !== undefined && item.submenu.length > 0 ? item.submenu : null

  // A flyout that would run off the right edge opens to the left of its parent. Measured in its
  // unflipped place each time it opens: closing resets the flip, so a reopen starts from there.
  useLayoutEffect(() => {
    if (!open) {
      setFlipped(false)
      return
    }
    const right = flyoutRef.current?.getBoundingClientRect().right
    if (right !== undefined && right > window.innerWidth) setFlipped(true)
  }, [open])

  // Opening a submenu moves focus into it, once it is in the document. If that focus is lost when
  // the flyout goes (a hover elsewhere took it), the parent item takes it back.
  useEffect(() => {
    const button = buttonRef.current
    if (!open || flyoutRef.current === null) return
    itemsIn(flyoutRef.current)[0]?.focus()
    return () => {
      if (document.activeElement === document.body) button?.focus()
    }
  }, [open])

  const button = (
    <button
      ref={buttonRef}
      className={submenu === null ? 'context-menu-item' : 'context-menu-item context-menu-parent'}
      data-testid={`context-menu-${item.id}`}
      data-separator={item.separator === true}
      role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
      aria-checked={item.checked}
      aria-haspopup={submenu === null ? undefined : 'menu'}
      aria-expanded={submenu === null ? undefined : open}
      disabled={item.disabled ?? false}
      title={item.disabled === true ? item.disabledReason : undefined}
      onClick={() => {
        if (submenu !== null) { onOpen(item.id); return }
        item.run?.()
        onClose()
      }}
      onMouseEnter={() => { onOpen(submenu === null ? null : item.id) }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight' && submenu !== null) { e.preventDefault(); onOpen(item.id) }
      }}
    >
      {item.checked !== undefined && <CheckIcon className="context-menu-check" on={item.checked} />}
      {item.label}
      {submenu !== null && <SubmenuArrowIcon className="context-menu-arrow" />}
    </button>
  )

  if (submenu === null) return button

  return (
    <div className="context-menu-sub">
      {button}
      {open && (
        <Menu
          className={flipped ? 'context-menu context-menu-flyout context-menu-flyout-left' : 'context-menu context-menu-flyout'}
          testId="context-submenu"
          ref={flyoutRef}
          focusOnOpen={false}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft') return
            e.preventDefault()
            onOpen(null)
            buttonRef.current?.focus()
          }}
        >
          {submenu.map((sub) => (
            <button
              key={sub.id}
              className="context-menu-item"
              data-testid={`context-menu-${sub.id}`}
              data-separator={sub.separator === true}
              role="menuitem"
              disabled={sub.disabled ?? false}
              title={sub.disabled === true ? sub.disabledReason : undefined}
              onClick={() => { sub.run?.(); onClose() }}
            >
              {sub.label}
            </button>
          ))}
        </Menu>
      )}
    </div>
  )
}

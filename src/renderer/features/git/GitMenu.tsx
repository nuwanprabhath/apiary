import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEscape } from '../../ui/useEscape'
import { itemsIn, onMenuKeyDown, useMenuOpenFocus } from '../../ui/Menu'

/** One command in the menu. A `submenu` opens a second panel beside this one instead of running. */
export interface GitMenuItem {
  id: string
  label: string
  /** Absent for a submenu parent, which opens rather than acts. */
  run?: () => void
  submenu?: GitMenuItem[]
  disabled?: boolean
  /** Draws a rule above this item, grouping what follows apart from what came before. */
  separatorBefore?: boolean
}

interface Props {
  items: GitMenuItem[]
  onClose: () => void
  /** The toolbar this menu belongs to. It opens upward from that element's top edge. */
  anchorRef: React.RefObject<HTMLElement | null>
}

/**
 * The toolbar's "..." menu: git commands, grouped the way VS Code groups its own Source Control
 * menu rather than spread across the toolbar as a row of ever-multiplying icons. Only the two or
 * three commands used constantly (pull, push, the branch name itself) stay out on the toolbar;
 * everything else lives in here.
 *
 * Anchored to the button that opened it and dismissed by Escape, a click anywhere outside, or
 * running any command. Escape is handled here rather than by each caller so every popup in the app
 * behaves the same way — see the same listener in BranchSwitcher.
 */
export function GitMenu({ items, onClose, anchorRef }: Props): JSX.Element {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const topListRef = useRef<HTMLUListElement | null>(null)
  const submenuRef = useRef<HTMLUListElement | null>(null)
  // Moving into a submenu (by ArrowRight or by activating its parent item) focuses its first item
  // once it exists — it isn't in the document until `openSubmenu` causes it to render.
  useEffect(() => {
    if (openSubmenu === null || submenuRef.current === null) return
    itemsIn(submenuRef.current)[0]?.focus()
  }, [openSubmenu])

  /**
   * Positioned `fixed`, against the anchor's measured box, rather than absolutely inside the
   * toolbar. The shell pane clips its own contents (`.bottom-pane { overflow: hidden }`, which is
   * what keeps a terminal inside its box), and this menu opens *upward* out of that pane — so
   * anything positioned within it would simply be cut off at the pane's top edge. Measured once
   * on open: every route out of this menu closes it, so there is no state in which the anchor
   * moves while it is still up.
   */
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  useEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 4 })
  }, [anchorRef])

  // Enabled once `position` is known, not simply on mount: before that the menu is rendered with
  // `visibility: hidden` (see below) so its width can be measured, and a hidden element cannot
  // take focus — an effect that ran on mount unconditionally would try to focus the first item
  // while it is still invisible, silently fail, and leave focus on the "..." button that opened it.
  useMenuOpenFocus(topListRef, position !== null)

  /**
   * Keeps the menu on screen once it has a width.
   *
   * It opens from a button that can sit at either end of the toolbar, so aligning its left edge to
   * the button would run it off the right of the window whenever the button is over there. Width
   * is only knowable after a render, which is why this is a second, corrective pass rather than
   * part of the measurement above.
   */
  useLayoutEffect(() => {
    if (position === null || rootRef.current === null) return
    const width = rootRef.current.getBoundingClientRect().width
    const clamped = Math.max(8, Math.min(position.left, window.innerWidth - width - 8))
    if (clamped !== position.left) setPosition({ ...position, left: clamped })
  }, [position])

  // Escape closes it via the shared stack (UI-13): only the top-most open layer reacts, so a
  // submenu or another popup opened from here isn't also closed by the same keypress.
  useEscape(onClose)
  useEffect(() => {
    // `mousedown`, not `click`: a click that lands on some other button should dismiss the menu
    // *and* still reach that button, which is what happens if the menu is already gone by the
    // time the click completes.
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current?.contains(e.target as Node) === true) return
      onClose()
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => { document.removeEventListener('mousedown', onPointerDown) }
  }, [onClose])

  const renderItem = (item: GitMenuItem, isSubmenuItem: boolean): JSX.Element => {
    const hasSubmenu = item.submenu !== undefined && item.submenu.length > 0
    return (
      <li key={item.id} role="none" className="git-menu-item-wrap" data-separator={item.separatorBefore ?? false}>
        <button
          className="git-menu-item"
          data-testid={`git-menu-${item.id}`}
          role="menuitem"
          disabled={item.disabled ?? false}
          aria-haspopup={hasSubmenu}
          aria-expanded={hasSubmenu ? openSubmenu === item.id : undefined}
          onClick={() => {
            // Opens, never toggles: hovering the row has already opened the submenu by the time
            // the click lands, so a toggle would shut it again on the way in — the submenu
            // flickering out from under the pointer just as you reach for it.
            if (hasSubmenu) { setOpenSubmenu(item.id); return }
            item.run?.()
            onClose()
          }}
          onMouseEnter={() => { if (hasSubmenu) setOpenSubmenu(item.id) }}
          onKeyDown={(e) => {
            // ArrowRight opens a submenu the same way a click does (focus follows in the effect
            // above, once it exists); ArrowLeft on a submenu item closes that submenu and returns
            // focus to the item that opened it — the WAI-ARIA menu pattern's "leave a submenu"
            // gesture. Both are scoped here, on the item itself, rather than on a `keydown` for the
            // whole menu, because which one applies depends on whether *this* item has a submenu
            // and whether it is already inside one.
            if (e.key === 'ArrowRight' && hasSubmenu) { e.preventDefault(); setOpenSubmenu(item.id); return }
            if (e.key === 'ArrowLeft' && isSubmenuItem) {
              e.preventDefault()
              setOpenSubmenu(null)
              // The parent item is whichever top-level button's aria-expanded is currently true —
              // simplest to find it back by the id `openSubmenu` still holds at this point.
              topListRef.current?.querySelector<HTMLElement>(`[data-testid="git-menu-${openSubmenu ?? ''}"]`)?.focus()
            }
          }}
        >
          <span className="git-menu-label">{item.label}</span>
          {hasSubmenu && (
            <svg className="git-menu-arrow" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        {hasSubmenu && openSubmenu === item.id && (
          <ul
            ref={submenuRef}
            className="git-menu git-submenu"
            data-testid="git-submenu"
            role="menu"
            onKeyDown={(e) => { if (submenuRef.current !== null) onMenuKeyDown(e, submenuRef.current) }}
          >
            {item.submenu?.map((sub) => renderItem(sub, true))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <div
      className="git-menu-root"
      ref={rootRef}
      style={position === null
        ? { visibility: 'hidden' }
        : { left: position.left, bottom: position.bottom }}
    >
      <ul
        ref={topListRef}
        className="git-menu"
        data-testid="git-menu"
        role="menu"
        onKeyDown={(e) => { if (topListRef.current !== null) onMenuKeyDown(e, topListRef.current) }}
      >
        {items.map((item) => renderItem(item, false))}
      </ul>
    </div>
  )
}

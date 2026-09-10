import { useEffect, useRef, useState } from 'react'

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
  anchorRef: React.RefObject<HTMLElement>
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
    setPosition({ left: rect.left + 6, bottom: window.innerHeight - rect.top + 4 })
  }, [anchorRef])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    // `mousedown`, not `click`: a click that lands on some other button should dismiss the menu
    // *and* still reach that button, which is what happens if the menu is already gone by the
    // time the click completes.
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

  const renderItem = (item: GitMenuItem): JSX.Element => {
    const hasSubmenu = item.submenu !== undefined && item.submenu.length > 0
    return (
      <li key={item.id} className="git-menu-item-wrap" data-separator={item.separatorBefore ?? false}>
        <button
          className="git-menu-item"
          data-testid={`git-menu-${item.id}`}
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
        >
          <span className="git-menu-label">{item.label}</span>
          {hasSubmenu && (
            <svg className="git-menu-arrow" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
        {hasSubmenu && openSubmenu === item.id && (
          <ul className="git-menu git-submenu" data-testid="git-submenu">
            {item.submenu?.map(renderItem)}
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
      <ul className="git-menu" data-testid="git-menu" role="menu">
        {items.map(renderItem)}
      </ul>
    </div>
  )
}

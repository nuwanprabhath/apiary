import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useEscape } from '../../ui/useEscape'
import { useOutsideDismiss } from '../../ui/useOutsideDismiss'
import { itemsIn, Menu } from '../../ui/Menu'
import { SubmenuArrowIcon } from '../../ui/icons'

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
 * The toolbar's "..." menu: git commands grouped like VS Code's Source Control menu; only pull,
 * push and the branch name stay on the toolbar.
 */
export function GitMenu({ items, onClose, anchorRef }: Props): JSX.Element {
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const topListRef = useRef<HTMLElement | null>(null)
  const submenuRef = useRef<HTMLElement | null>(null)
  // The submenu is not in the document until `openSubmenu` renders it, so focus its first item then.
  useEffect(() => {
    if (openSubmenu === null || submenuRef.current === null) return
    itemsIn(submenuRef.current)[0]?.focus()
  }, [openSubmenu])
  // The "..." button sits at the toolbar's right end, so a submenu opening rightwards can run off
  // the window; measured on each open, it then opens left of its parent (as ContextMenu's do).
  const [submenuLeft, setSubmenuLeft] = useState(false)
  useLayoutEffect(() => {
    if (openSubmenu === null) { setSubmenuLeft(false); return }
    const right = submenuRef.current?.getBoundingClientRect().right
    if (right !== undefined && right > window.innerWidth) setSubmenuLeft(true)
  }, [openSubmenu])

  /**
   * Positioned `fixed` against the anchor's measured box: the shell pane clips its contents
   * (`.bottom-pane { overflow: hidden }`) and this menu opens upward out of it. Measured once on
   * open: every route out of the menu closes it, so the anchor cannot move while it is up.
   */
  const [position, setPosition] = useState<{ left: number; bottom: number } | null>(null)
  useEffect(() => {
    const rect = anchorRef.current?.getBoundingClientRect()
    if (rect === undefined) return
    setPosition({ left: rect.left, bottom: window.innerHeight - rect.top + 4 })
  }, [anchorRef])

  /** Keeps the menu on screen: the button can sit at either end, and the width is only knowable
   *  after a render, hence a second, corrective pass. */
  useLayoutEffect(() => {
    if (position === null || rootRef.current === null) return
    const width = rootRef.current.getBoundingClientRect().width
    const clamped = Math.max(8, Math.min(position.left, window.innerWidth - width - 8))
    if (clamped !== position.left) setPosition({ ...position, left: clamped })
  }, [position])

  // Only the top-most open layer on the shared Escape stack reacts, so a popup opened from here
  // is not also closed by the same keypress.
  useEscape(onClose)
  useOutsideDismiss(onClose, { inside: [rootRef] })

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
            // Per item rather than per menu: which key applies depends on whether this item has a
            // submenu and whether it is already inside one.
            if (e.key === 'ArrowRight' && hasSubmenu) { e.preventDefault(); setOpenSubmenu(item.id); return }
            if (e.key === 'ArrowLeft' && isSubmenuItem) {
              e.preventDefault()
              setOpenSubmenu(null)
              topListRef.current?.querySelector<HTMLElement>(`[data-testid="git-menu-${openSubmenu ?? ''}"]`)?.focus()
            }
          }}
        >
          <span className="git-menu-label">{item.label}</span>
          {hasSubmenu && <SubmenuArrowIcon className="git-menu-arrow" />}
        </button>
        {hasSubmenu && openSubmenu === item.id && (
          <Menu as="ul" ref={submenuRef} className={submenuLeft ? 'git-menu git-submenu git-submenu-left' : 'git-menu git-submenu'} testId="git-submenu" focusOnOpen={false}>
            {item.submenu?.map((sub) => renderItem(sub, true))}
          </Menu>
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
      {/* Enabled once `position` is known, not simply on mount: before that the menu is rendered
          with `visibility: hidden` (see above) so its width can be measured, and a hidden element
          cannot take focus — an effect that ran on mount would try to focus the first item while it
          is still invisible, silently fail, and leave focus on the "..." button that opened it. */}
      <Menu as="ul" ref={topListRef} className="git-menu" testId="git-menu" focusOnOpen={position !== null}>
        {items.map((item) => renderItem(item, false))}
      </Menu>
    </div>
  )
}

import { useLayoutEffect, useRef, useState, type JSX, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Menu } from './Menu'
import { ChevronsRightIcon } from './icons'
import { placeUnderRightEdge } from './popoverPlacement'
import { useOutsideDismiss } from './useOutsideDismiss'
import { useEscape } from './useEscape'

export interface OverflowToolbarItem {
  id: string
  icon: ReactNode
  label?: string
  /** A small count after the label (a branch's behind/ahead), kept when the label is hidden. */
  badge?: string
  /**
   * What the label does when the row is short of room. `shrink`: it narrows to about 6em with an
   * ellipsis (its full text is in the title), then hides. `collapse`: it hides whole, last of all.
   * Unset: it always shows.
   */
  labelMode?: 'shrink' | 'collapse'
  /** The tooltip; for a disabled item it also says why, and the overflow menu shows it too. */
  title: string
  testId: string
  disabled?: boolean
  active?: boolean
  /** Sets `aria-expanded`, for an item that opens or closes something. */
  expanded?: boolean
  tone?: 'normal' | 'suggest' | 'problem'
  /** Set when something opens from this button and needs its box to position against. */
  buttonRef?: RefObject<HTMLButtonElement | null>
  /** Lower numbers are more important and stay visible longer; higher numbers overflow first. */
  priority?: number
  /** Never moves into the menu (the shell toggle, the branch). */
  pinned?: boolean
  /** Packs the item against the end of the row (the first such item takes the free space). */
  end?: boolean
  onClick: () => void
}

interface Props {
  items: OverflowToolbarItem[]
  /** Names the row (`role="toolbar"`). */
  label?: string
  /** The » button, for a caller that opens something from it when its own button is in the menu. */
  moreRef?: RefObject<HTMLButtonElement | null>
}

const DEFAULT_PRIORITY = 100

/**
 * A toolbar that moves items that do not fit, whole, into a "More actions" (») menu: a popup
 * rendered on the viewport (a portal), under the » button with its right edge on the button's, or
 * above it when there is no room below. Items keep their array order on screen; `priority` only
 * decides who goes first (higher numbers overflow first). A `pinned` item never moves: its label
 * gives way instead (see `labelMode`).
 *
 * Widths come from a hidden copy of every item, so an item that is in the menu can still be
 * measured and comes back when the room does. A ResizeObserver on the row and on that copy
 * re-runs the fit. The row is one line tall whatever is in the menu.
 */
export function OverflowToolbar({ items, label = 'Actions', moreRef }: Props): JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const ownMoreRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const [visibleIds, setVisibleIds] = useState<ReadonlySet<string> | null>(null)
  const [compact, setCompact] = useState(0)

  const setMore = (node: HTMLButtonElement | null): void => {
    ownMoreRef.current = node
    if (moreRef !== undefined) moreRef.current = node
  }

  useEscape(() => setOpen(false), { enabled: open })
  useOutsideDismiss(() => setOpen(false), { enabled: open, inside: [ownMoreRef, menuRef] })

  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return
    const fit = (): void => {
      const widths = new Map<string, number>()
      for (const el of measure.querySelectorAll<HTMLElement>('[data-measure-id]')) {
        widths.set(el.dataset.measureId ?? '', el.getBoundingClientRect().width)
      }
      const gap = parseFloat(getComputedStyle(measure).columnGap) || 0
      const next = chooseVisible(items, widths, row.clientWidth, gap, widths.get('') ?? 0)
      const labels = new Map<string, number>()
      for (const el of measure.querySelectorAll<HTMLElement>('[data-measure-id]')) {
        const label = el.querySelector('.toolbar-button-label')
        if (label) labels.set(el.dataset.measureId ?? '', label.getBoundingClientRect().width)
      }
      setVisibleIds((prev) => (prev && sameIds(prev, next) ? prev : next))
      setCompact(chooseCompact(items, next, { widths, labels, available: row.clientWidth, gap }))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(row)
    observer.observe(measure)
    return () => observer.disconnect()
  }, [items])

  const shown = visibleIds ?? new Set(items.map((i) => i.id))
  const visibleItems = items.filter((item) => shown.has(item.id))
  const overflowItems = items.filter((item) => !shown.has(item.id))
  const firstEnd = visibleItems.find((i) => i.end)?.id
  const menuOpen = open && overflowItems.length > 0

  // Placed against the » button once the menu has a size; the menu is hidden until then.
  useLayoutEffect(() => {
    if (!menuOpen) { setPosition(null); return }
    const anchor = ownMoreRef.current
    const menu = menuRef.current
    if (!anchor || !menu) return
    const { width, height } = menu.getBoundingClientRect()
    setPosition(placeUnderRightEdge(anchor.getBoundingClientRect(), { width, height }))
  }, [menuOpen, overflowItems.length])

  useLayoutEffect(() => {
    if (!menuOpen) return
    const close = (): void => setOpen(false)
    window.addEventListener('resize', close)
    return () => window.removeEventListener('resize', close)
  }, [menuOpen])

  return (
    <div ref={rowRef} className="overflow-toolbar" role="toolbar" aria-label={label} data-compact={compact}>
      {visibleItems.map((item) => (
        <OverflowToolbarButton key={item.id} item={item} pushEnd={item.id === firstEnd} />
      ))}
      {overflowItems.length > 0 && (
        <button
          ref={setMore}
          className={firstEnd === undefined ? 'toolbar-button overflow-toolbar-push' : 'toolbar-button'}
          data-testid="overflow-menu-button"
          title="More actions"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setOpen((v) => !v)}
        >
          <ChevronsRightIcon />
        </button>
      )}
      {menuOpen && (
        <OverflowMenu menuRef={menuRef} position={position} items={overflowItems} onClose={() => setOpen(false)} />
      )}
      <div ref={measureRef} className="overflow-toolbar-measure" aria-hidden="true" inert>
        {items.map((item) => (
          <OverflowToolbarButton key={item.id} item={item} measureId={item.id} />
        ))}
        <button className="toolbar-button" data-measure-id="" tabIndex={-1}>
          <ChevronsRightIcon />
        </button>
      </div>
    </div>
  )
}

/**
 * How much label to give up so the kept items fit: 0 none, 1 the shrinking label (the branch name)
 * is hidden, 2 the collapsing label (the word "Shell") too. Computed from the measured copy in the
 * same pass as the fit, so the row never has a frame with something cut off.
 */
function chooseCompact(
  items: OverflowToolbarItem[],
  keep: ReadonlySet<string>,
  m: { widths: ReadonlyMap<string, number>; labels: ReadonlyMap<string, number>; available: number; gap: number },
): number {
  const kept = items.filter((i) => keep.has(i.id))
  if (kept.length === items.length) return 0
  // With anything in the menu, the » button takes the last place in the row.
  const total = kept.reduce((sum, i) => sum + (m.widths.get(i.id) ?? 0), 0) + (m.widths.get('') ?? 0) + m.gap * kept.length
  if (total <= m.available) return 0
  const shrinking = kept.filter((i) => i.labelMode === 'shrink').reduce((sum, i) => sum + (m.labels.get(i.id) ?? 0), 0)
  return total - shrinking <= m.available ? 1 : 2
}

/** The popup: on the viewport, hidden until `position` says where (it needs its own size first). */
function OverflowMenu({ menuRef, position, items, onClose }: {
  menuRef: RefObject<HTMLElement | null>
  position: { left: number; top: number } | null
  items: OverflowToolbarItem[]
  onClose: () => void
}): JSX.Element {
  return createPortal(
    <Menu
      as="ul"
      ref={menuRef}
      className="context-menu-floating overflow-menu"
      testId="overflow-menu"
      focusOnOpen={position !== null}
      style={position ?? { left: 0, top: 0, visibility: 'hidden' }}
    >
      {items.map((item) => (
        <li key={item.id} role="none">
          <button
            role="menuitem"
            className="overflow-menu-item"
            data-testid={`overflow-${item.testId}`}
            disabled={item.disabled}
            title={item.title}
            onClick={() => {
              onClose()
              item.onClick()
            }}
          >
            {item.icon}
            <span className="overflow-menu-item-label">{item.label ?? item.title}</span>
            {item.badge !== undefined && <span className="toolbar-badge">{item.badge}</span>}
          </button>
        </li>
      ))}
    </Menu>,
    document.body,
  )
}

/** Greedy by priority: keep the pinned items, then the most important that fit beside the » button. */
function chooseVisible(
  items: OverflowToolbarItem[],
  widths: ReadonlyMap<string, number>,
  available: number,
  gap: number,
  menuWidth: number,
): Set<string> {
  const width = (i: OverflowToolbarItem): number => widths.get(i.id) ?? 0
  const total = items.reduce((sum, i) => sum + width(i), 0) + gap * Math.max(0, items.length - 1)
  if (total <= available) return new Set(items.map((i) => i.id))
  const keep = new Set<string>()
  let used = menuWidth
  for (const item of items.filter((i) => i.pinned)) {
    keep.add(item.id)
    used += gap + width(item)
  }
  const movable = items.filter((i) => !i.pinned)
  const byPriority = [...movable].sort((a, b) => (a.priority ?? DEFAULT_PRIORITY) - (b.priority ?? DEFAULT_PRIORITY))
  for (const item of byPriority) {
    const next = used + gap + width(item)
    if (next > available) break
    keep.add(item.id)
    used = next
  }
  return keep
}

function sameIds(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((x) => b.has(x))
}

function OverflowToolbarButton({ item, measureId, pushEnd }: {
  item: OverflowToolbarItem
  measureId?: string
  pushEnd?: boolean
}): JSX.Element {
  const measuring = measureId !== undefined
  const classes = ['toolbar-button']
  if (pushEnd) classes.push('overflow-toolbar-push')
  // The copy that is measured has its shrinking label already at its narrowest.
  if (item.labelMode === 'shrink') classes.push(measuring ? 'toolbar-chip toolbar-chip-min' : 'toolbar-chip')
  return (
    <button
      ref={measuring ? undefined : item.buttonRef}
      data-item-id={measuring ? undefined : item.id}
      data-measure-id={measureId}
      tabIndex={measuring ? -1 : undefined}
      className={classes.join(' ')}
      data-testid={measuring ? undefined : item.testId}
      data-active={item.active ?? false}
      data-tone={item.tone ?? 'normal'}
      title={measuring ? undefined : item.title}
      aria-label={measuring ? undefined : item.title}
      aria-expanded={measuring ? undefined : item.expanded}
      disabled={item.disabled}
      onClick={measuring ? undefined : item.onClick}
    >
      {item.icon}
      {item.label !== undefined && (
        <span
          className="toolbar-button-label"
          data-mode={item.labelMode}
          {...(item.labelMode === 'shrink' ? { 'data-ui-allow': 'clipped-text: branch name, full name in its tooltip' } : {})}
        >
          {item.label}
        </span>
      )}
      {item.badge !== undefined && <span className="toolbar-badge">{item.badge}</span>}
    </button>
  )
}

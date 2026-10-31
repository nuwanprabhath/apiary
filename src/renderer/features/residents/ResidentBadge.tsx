import { type JSX, useEffect, useState } from 'react'
import { type ResidentAppearance, type ResidentGlyph, type ResidentStatus, WAITING_FOR_OK } from '@shared/domain/residents'
import { useResidents } from '../../state/residentsStore'
import { useResidentHistory } from '../../state/residentChat'
import { toggleResidentPopup, useResidentPopup } from '../../state/residentPopup'
import { readResidentSeen, writeResidentSeen } from '../../state/uiState'
import { useStatusBarSize } from '../../state/statusBarSize'
import { ContextMenu } from '../../ui/ContextMenu'
import { BeeIcon } from '../../ui/icons/BeeIcon'
import { HoneypotIcon } from '../../ui/icons/HoneypotIcon'
import { useHoverCard } from '../../ui/useHoverCard'
import { ResidentHoverCard } from './ResidentHoverCard'
import { residentMenuItems } from './residentMenu'

const RESIDENT_GLYPHS: Record<ResidentGlyph, (props: { className?: string }) => JSX.Element> = { bee: BeeIcon, honeypot: HoneypotIcon }

/**
 * The resident's glyph in its haloed orb. The glyph, the halo's colours (`data-palette`, mapped to
 * the `--resident-tint*` variables in styles/36-residents.css) and the motion (`data-animation`)
 * come from the kind's appearance; the halo, the glow and the breathing are shared by every kind.
 */
export function ResidentOrb({ state, appearance, small = false }: { state: ResidentStatus['state']; appearance: ResidentAppearance; small?: boolean }): JSX.Element {
  const Glyph = RESIDENT_GLYPHS[appearance.glyph]
  return (
    <span
      className="resident-orb"
      data-state={state}
      data-glyph={appearance.glyph}
      data-palette={appearance.palette}
      data-animation={appearance.animation}
      data-size={small ? 'sm' : undefined}
      aria-hidden="true"
    >
      <Glyph className="resident-glyph" />
      {state === 'asleep' && <span className="resident-z">z</span>}
    </span>
  )
}

/**
 * Whether an assistant message arrived that the person has not seen in the popup. The id of the
 * newest message seen is kept per resident in `uiState`, and moved on while the popup shows it.
 */
function useUnread(residentId: string, open: boolean): boolean {
  const history = useResidentHistory(residentId)
  const [seen, setSeen] = useState(() => readResidentSeen(residentId))
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.id ?? null
  const last = history.at(-1)?.id ?? null
  useEffect(() => {
    if (!open || last === null || last === seen) return
    writeResidentSeen(residentId, last)
    setSeen(last)
  }, [open, last, seen, residentId])
  if (open || lastAssistant === null || seen === lastAssistant) return false
  return seen === null || history.findIndex((m) => m.id === seen) < history.findIndex((m) => m.id === lastAssistant)
}

/** What the resident needs the person for: the badge's count and the words its pill says, or null. */
function residentNeeds(resident: ResidentStatus): { count: string; summary: string } | null {
  const { attention, permissions } = resident
  if (attention === null && permissions.length === 0) return null
  const count = attention?.count ?? permissions.length
  return { count: count > 0 ? String(count) : '!', summary: attention?.summary ?? WAITING_FOR_OK }
}

/**
 * A resident in the status bar: its glyph sleeps, glows or works. Working, it grows into a pill
 * that says what it is doing; the bar grows a little with it (pure CSS on `data-state`). Needing
 * the person, a ring pulses out of it, a count replaces the unread dot and, unless it is working,
 * the pill says what is wanted. A click opens or closes its chat popup; a right-click, the
 * context-menu key or Shift+F10 opens its quick actions; hovering, or focus from the keyboard,
 * shows `ResidentHoverCard`.
 */
function ResidentBadge({ resident, onOpenSettings }: { resident: ResidentStatus; onOpenSettings: (section: string) => void }): JSX.Element {
  const open = useResidentPopup().openId === resident.id
  const unread = useUnread(resident.id, open)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const needs = residentNeeds(resident)
  const pill = resident.state === 'working' ? resident.activity ?? 'Working…' : needs?.summary ?? null
  const hover = useHoverCard<HTMLButtonElement>()
  const tall = useStatusBarSize().tier === 'tall'
  return (
    <>
      <button
        ref={hover.ref}
        type="button"
        className="resident-badge"
        aria-describedby={hover.anchor === null ? undefined : `resident-hover-${resident.id}`}
        onMouseEnter={hover.arm}
        onMouseLeave={hover.scheduleClose}
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) hover.openNow() }}
        onBlur={hover.hideNow}
        data-testid={`resident-badge-${resident.id}`}
        data-state={resident.state}
        data-palette={resident.appearance.palette}
        data-needs={needs !== null ? 'true' : undefined}
        aria-label={`${resident.name}: ${resident.state}${pill === null ? '' : `, ${pill}`}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => { hover.hideNow(); toggleResidentPopup(resident.id) }}
        onContextMenu={(e) => { e.preventDefault(); hover.hideNow(); setMenu({ x: e.clientX, y: e.clientY }) }}
        onKeyDown={(e) => {
          if (e.key !== 'ContextMenu' && !(e.key === 'F10' && e.shiftKey)) return
          e.preventDefault()
          const rect = e.currentTarget.getBoundingClientRect()
          setMenu({ x: rect.left, y: rect.top })
        }}
      >
        <span className="resident-badge-orb">
          <ResidentOrb state={resident.state} appearance={resident.appearance} />
          {needs !== null && <span className="resident-count" data-testid="resident-count">{needs.count}</span>}
          {needs === null && unread && <span className="resident-unread" data-testid="resident-unread" />}
        </span>
        {tall && pill !== null ? (
          <span className="resident-lines">
            <span className="resident-name">{resident.name}</span>
            <span className="resident-activity">{pill}</span>
          </span>
        ) : <span className="resident-activity">{pill ?? ''}</span>}
      </button>
      {hover.anchor !== null && menu === null && (
        <ResidentHoverCard resident={resident} anchor={hover.anchor} onPointerEnter={hover.keepOpen} onPointerLeave={hover.scheduleClose} />
      )}
      <ContextMenu
        items={residentMenuItems(resident, onOpenSettings)}
        position={menu}
        onClose={() => { setMenu(null) }}
        testId="resident-menu"
      />
    </>
  )
}

/** Every configured resident's badge, enabled or not, in the order of the `residents` setting. */
export function ResidentBadges({ onOpenSettings }: { onOpenSettings: (section: string) => void }): JSX.Element {
  return <>{useResidents().map((r) => <ResidentBadge key={r.id} resident={r} onOpenSettings={onOpenSettings} />)}</>
}

/** Whether any resident is configured: the status bar shows for one even with nothing else in it. */
export function useHasResidents(): boolean {
  return useResidents().length > 0
}

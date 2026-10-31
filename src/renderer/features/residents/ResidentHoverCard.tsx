import { type JSX, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ResidentStatus } from '@shared/domain/residents'
import { useAppSettings } from '../../state/settingsStore'
import { useResidentKinds } from '../../state/residentSettings'
import { clampLeft, POPOVER_GAP, POPOVER_MARGIN } from '../../ui/popoverPlacement'
import { residentCardLines } from './residentCard'

/**
 * What a resident is and what it is doing, over its badge in the status bar: the name and its
 * kind's blurb, then Now, Needs you, Checks, Digest and Setup when each has something to say.
 * Opened by hover or focus (`useHoverCard` in `ResidentBadge`), placed above the badge.
 */
export function ResidentHoverCard({ resident, anchor, onPointerEnter, onPointerLeave }: {
  resident: ResidentStatus
  anchor: DOMRect
  onPointerEnter: () => void
  onPointerLeave: () => void
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const blurb = useResidentKinds().find((k) => k.id === resident.kind)?.blurb ?? null
  const schedule = useAppSettings().residents.find((c) => c.id === resident.id)?.schedule ?? null
  // The card mounts each time it opens, so the clock it reads is the moment it opened.
  const [now] = useState(() => new Date())
  const lines = residentCardLines(resident, schedule, now)
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    const above = anchor.top - POPOVER_GAP - box.height
    setPos({ left: clampLeft(anchor.left, box.width), top: Math.max(POPOVER_MARGIN, above) })
  }, [anchor, lines.length])
  return createPortal(
    <div
      ref={ref}
      className="hover-card"
      role="tooltip"
      id={`resident-hover-${resident.id}`}
      data-testid={`resident-hover-${resident.id}`}
      style={pos === null ? { left: 0, top: 0, visibility: 'hidden' } : { left: pos.left, top: pos.top }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
    >
      <div className="hover-card-title">{resident.name}</div>
      {blurb !== null && <div className="resident-hover-blurb">{blurb}</div>}
      {lines.map((line) => (
        <div key={line.label} className="hover-card-row" data-testid={`resident-hover-${line.label === 'Needs you' ? 'needs' : line.label.toLowerCase()}`}>
          <span className="hover-card-label">{line.label}</span>
          <span className="resident-hover-text">{line.text}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ActivityStatus } from '@shared/activity'
import { describeActivityStatus } from '@shared/activity'
import { clampLeft, clampTop, fitsHorizontally, POPOVER_GAP } from '../../ui/popoverPlacement'

/**
 * What each status dot in the Active section means, shown when the pointer rests on the section
 * header. Each row draws a real `.status-dot`, so its animation is the one on the rows: a still
 * swatch would leave the motion, which separates "working" from "needs you", undocumented.
 */
const ENTRIES: { status: ActivityStatus; meaning: string }[] = [
  { status: 'running', meaning: 'Claude is working. Nothing needed from you.' },
  { status: 'waiting', meaning: 'Claude asked a question and is waiting on your answer.' },
  { status: 'idle', meaning: 'Open and alive, but nothing is happening.' },
  { status: 'stopped', meaning: 'The terminal has exited. Resume it to carry on.' },
]

export function ActivityLegend({ anchor }: { anchor: DOMRect }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measured after layout, like HoverCard: the width is content-driven.
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    // Beside the header, not below it: below would cover the very dots it explains.
    const beside = anchor.right + POPOVER_GAP
    const left = fitsHorizontally(beside, box.width) ? beside : clampLeft(beside, box.width)
    setPos({ left, top: clampTop(anchor.top, box.height) })
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      className="hover-card activity-legend"
      data-testid="activity-legend"
      role="tooltip"
      style={pos === null
        ? { left: 0, top: 0, visibility: 'hidden' }
        : { left: pos.left, top: pos.top }}
    >
      <div className="hover-card-title">What the dots mean</div>
      {ENTRIES.map(({ status, meaning }) => (
        <div className="activity-legend-row" key={status}>
          <span className="status-dot" data-status={status} aria-hidden="true" />
          <span className="activity-legend-name">{describeActivityStatus(status)}</span>
          <span className="activity-legend-meaning">{meaning}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

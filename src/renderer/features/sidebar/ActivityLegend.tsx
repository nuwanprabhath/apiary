import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ActivityStatus } from '@shared/activity'
import { describeActivityStatus } from '@shared/activity'

/**
 * What each status dot in the Active section means, shown when the pointer rests on the section
 * header.
 *
 * Four coloured dots with four different motions is a language nobody was taught. The dots are
 * worth keeping — they are readable at a glance once you know them, which is the entire point of
 * a mission-control list — so the legend teaches them where the question is asked, rather than
 * pushing the explanation into a settings page or a README nobody opens mid-task.
 *
 * Each row draws a real `.status-dot`, not a picture of one, so the animation in the legend is
 * literally the animation on the row above it. A still swatch would explain the colours and leave
 * the motion — the part that actually distinguishes "working" from "needs you" — undocumented.
 */
const ENTRIES: { status: ActivityStatus; meaning: string }[] = [
  { status: 'running', meaning: 'Claude is working. Nothing needed from you.' },
  { status: 'waiting', meaning: 'Claude asked a question and is waiting on your answer.' },
  { status: 'idle', meaning: 'Open and alive, but nothing is happening.' },
  { status: 'stopped', meaning: 'The terminal has exited. Resume it to carry on.' },
]

const GAP = 6
const MARGIN = 8

export function ActivityLegend({ anchor }: { anchor: DOMRect }): React.ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Measured after paint, like HoverCard: the width is content-driven, so where it has to sit to
  // stay on screen cannot be known until it has been laid out once.
  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    // Beside the header, not below it: below puts the panel straight over the Active rows, which
    // are the very dots it is explaining — you would be reading the key with the map covered up.
    // It falls back to below only when there is genuinely no room to the right.
    const beside = anchor.right + GAP
    const left = beside + box.width + MARGIN <= window.innerWidth
      ? beside
      : Math.max(MARGIN, window.innerWidth - box.width - MARGIN)
    const top = Math.min(
      Math.max(MARGIN, anchor.top),
      Math.max(MARGIN, window.innerHeight - box.height - MARGIN),
    )
    setPos({ left, top })
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

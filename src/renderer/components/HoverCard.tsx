import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * A hover card for a sidebar row.
 *
 * This replaces a plain `title` attribute, which was the first attempt and looked right in a test
 * — the attribute was there and its contents were correct — while being close to invisible in
 * use: the OS tooltip takes a second or more to appear, renders in the system style, and truncates
 * multi-line text differently on each platform. A row's details are worth reading at a glance, so
 * they are drawn here instead, on a delay short enough to feel like an answer and long enough not
 * to flicker as the pointer crosses the list.
 *
 * Positioned `fixed` and portalled to the body: the sidebar is a scroll container, and a card
 * inside it is clipped by its edge exactly where the card needs to overhang.
 */
export const HOVER_DELAY_MS = 350

interface Props {
  /** The anchor's rectangle, in viewport coordinates. */
  anchor: DOMRect
  title: string
  path: string
  branch: string | null
  lastActive: string | null
  /** Shown when the folder a session ran in no longer exists. */
  missing?: boolean
}

const GAP = 8
const MARGIN = 8

export function HoverCard({ anchor, title, path, branch, lastActive, missing }: Props): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  // Placed once its own size is known: a card is positioned relative to its width, which cannot
  // be measured before it renders. It starts offscreen rather than at 0,0 so the first paint is
  // never a flash in the corner of the window.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    // Beside the row by preference, flipping to its left when the window has no room on the
    // right — a card half off the screen says less than no card at all.
    const right = anchor.right + GAP
    const left = right + box.width + MARGIN <= window.innerWidth
      ? right
      : Math.max(MARGIN, anchor.left - GAP - box.width)
    const top = Math.min(
      Math.max(MARGIN, anchor.top),
      Math.max(MARGIN, window.innerHeight - box.height - MARGIN),
    )
    setPos({ left, top })
  }, [anchor])

  return createPortal(
    <div
      ref={ref}
      className="hover-card"
      data-testid="session-hover-card"
      role="tooltip"
      style={pos === null
        ? { visibility: 'hidden', left: 0, top: 0 }
        : { left: pos.left, top: pos.top }}
    >
      <div className="hover-card-title">{title}</div>
      <div className="hover-card-path" data-testid="hover-card-path">{path}</div>
      {missing === true && <div className="hover-card-missing">This folder no longer exists.</div>}
      {branch !== null && (
        <div className="hover-card-row">
          <span className="hover-card-label">Branch</span>
          <span className="hover-card-branch">{branch}</span>
        </div>
      )}
      {lastActive !== null && (
        <div className="hover-card-row">
          <span className="hover-card-label">Last active</span>
          <span>{lastActive}</span>
        </div>
      )}
    </div>,
    document.body,
  )
}

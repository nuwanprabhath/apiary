import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { CopyIcon, CheckIcon } from './icons'
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
 *
 * It sits *below* the row rather than beside it. Beside meant the card covered the sessions either
 * side of the one being pointed at, which are exactly the rows someone is comparing it against; a
 * card underneath pushes into the space below the pointer, which is where the eye already is.
 *
 * It is also interactive — it has a button on it — so it stays up while the pointer is on it. The
 * gap between the row and the card is crossed without the card closing, because the two are
 * treated as one hover region by the caller (see SessionRow).
 */
export const HOVER_DELAY_MS = 350

interface Props {
  /** The anchor's rectangle, in viewport coordinates. */
  anchor: DOMRect
  /** Keeps the card open while the pointer is on it, and closes it on the way out. */
  onPointerEnter: () => void
  onPointerLeave: () => void
  title: string
  path: string
  branch: string | null
  /** The branch the session ran on, when that is not the branch the folder is on now. */
  recordedBranch?: string | null
  lastActive: string | null
  /** The user's own note, shown first — it is the thing they wrote to be read here. */
  note?: string | null
  /** Shown when the folder a session ran in no longer exists. */
  missing?: boolean
}

const GAP = 8
const MARGIN = 8

export function HoverCard(
  {
    anchor, title, path, branch, recordedBranch, lastActive, note, missing,
    onPointerEnter, onPointerLeave,
  }: Props,
): JSX.Element {
  const [copied, setCopied] = useState(false)
  // The tick is an acknowledgement, not a state worth keeping: it goes back to the copy glyph so
  // the button does not claim a copy made a minute ago is the one just now.
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => { setCopied(false) }, 1200)
    return () => { window.clearTimeout(timer) }
  }, [copied])
  const ref = useRef<HTMLDivElement | null>(null)
  // Placed once its own size is known: a card is positioned relative to its width, which cannot
  // be measured before it renders. It starts offscreen rather than at 0,0 so the first paint is
  // never a flash in the corner of the window.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    // Below the row, flipping above it only when the bottom of the window leaves no room — a card
    // that runs off the bottom edge is one whose last lines cannot be read.
    const below = anchor.bottom + GAP
    const top = below + box.height + MARGIN <= window.innerHeight
      ? below
      : Math.max(MARGIN, anchor.top - GAP - box.height)
    // Left-aligned with the row, so the card and the row it belongs to share an edge; pulled back
    // only as far as the window forces.
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - box.width - MARGIN))
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
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      // A portal moves the card in the DOM but not in the React tree, so its events still bubble
      // to the row that rendered it — including to the row's "hide when clicked" handler, which
      // unmounted the card from under the pointer before the click on this button could land.
      onMouseDown={(e) => { e.stopPropagation() }}
    >
      <div className="hover-card-title">{title}</div>
      {note !== null && note !== undefined && note !== '' && (
        // Above the path rather than below it: the note is why someone wrote anything at all, and
        // burying it under the metadata would make it the last thing read.
        <div className="hover-card-note" data-testid="hover-card-note">{note}</div>
      )}
      <div className="hover-card-path" data-testid="hover-card-path">{path}</div>
      {missing === true && <div className="hover-card-missing">This folder no longer exists.</div>}
      {branch !== null && (
        <div className="hover-card-row">
          <span className="hover-card-label">Branch</span>
          <span className="hover-card-branch">{branch}</span>
          <button
            className="hover-card-copy"
            data-testid="hover-card-copy-branch"
            title={copied ? 'Copied' : 'Copy branch name'}
            aria-label={`Copy branch name ${branch}`}
            onClick={() => {
              void window.apiary.copyToClipboard(branch).then(() => { setCopied(true) })
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
      )}
      {recordedBranch !== null && recordedBranch !== undefined && (
        <div className="hover-card-row">
          <span className="hover-card-label">Ran on</span>
          <span className="hover-card-branch hover-card-stale">{recordedBranch}</span>
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

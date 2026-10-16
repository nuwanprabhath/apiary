import { type JSX, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownIcon, CopyIcon, CheckIcon } from './icons'
import { MrRefText, type MrState } from './mrRefText'
import { createPortal } from 'react-dom'
import { copyText } from '../state/clipboard'
import { clampLeft, clampTop, fitsHorizontally, POPOVER_MARGIN } from './popoverPlacement'

/**
 * A hover card for a sidebar row. Not a `title` attribute: the OS tooltip is slow, system-styled
 * and truncates multi-line text differently per platform.
 *
 * Portalled to the body: the sidebar is a scroll container whose edge would clip the card where it
 * needs to overhang. It has buttons, so the caller treats row and card as one hover region.
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
  /** Resolved GitLab status for each `!<iid>` reference the note contains, computed by the caller
   *  (SessionRow) so this component stays a pure display component with no IPC calls of its own. */
  noteMrStatuses?: Record<number, MrState | null>
  /** Shown when the folder a session ran in no longer exists. */
  missing?: boolean
  /** Only true once main-process detection has found VS Code and the folder exists. */
  canOpenInVsCode?: boolean
  onOpenInVsCode?: () => void
  /**
   * Fast-forwards the branch from its upstream. Only a folder's card offers it: a folder's branch
   * is what its worktree has checked out *now*, while a session card's may be the branch it was
   * recorded on months ago — pulling that into today's checkout would be the wrong branch.
   * Resolves once the pull has finished, successfully or not; the caller reports the outcome.
   */
  onPullBranch?: () => Promise<void>
  testId?: string
}

const CARD_GAP = 8

function useCopiedTick(): { copied: 'branch' | 'path' | null; setCopied: (v: 'branch' | 'path') => void } {
  const [copied, setCopied] = useState<'branch' | 'path' | null>(null)
  useEffect(() => {
    if (copied === null) return
    const timer = window.setTimeout(() => { setCopied(null) }, 1200)
    return () => { window.clearTimeout(timer) }
  }, [copied])
  return { copied, setCopied }
}

function useCardPlacement(anchor: Props['anchor']): { ref: React.RefObject<HTMLDivElement | null>; pos: { left: number; top: number } | null } {
  const ref = useRef<HTMLDivElement | null>(null)
  // Null until the card's own size is measured; it renders hidden meanwhile.
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (el === null) return
    const box = el.getBoundingClientRect()
    // Beside the row: below it the card would cover the sessions someone compares against, and
    // reaching it beside crosses no other row.
    const beside = anchor.right + CARD_GAP
    if (fitsHorizontally(beside, box.width)) {
      setPos({ left: beside, top: clampTop(anchor.top, box.height) })
      return
    }
    // Too narrow to fit beside: below the row, flipping above only when the window's bottom leaves no room.
    const below = anchor.bottom + CARD_GAP
    const top = below + box.height + POPOVER_MARGIN <= window.innerHeight
      ? below
      : Math.max(POPOVER_MARGIN, anchor.top - CARD_GAP - box.height)
    setPos({ left: clampLeft(anchor.left, box.width), top })
  }, [anchor])
  return { ref, pos }
}

export function HoverCard(
  {
    anchor, title, path, branch, recordedBranch, lastActive, note, noteMrStatuses, missing,
    canOpenInVsCode, onOpenInVsCode, onPullBranch,
    testId = 'session-hover-card',
    onPointerEnter, onPointerLeave,
  }: Props,
): JSX.Element {
  const { copied, setCopied } = useCopiedTick()
  const [pulling, setPulling] = useState(false)
  const { ref, pos } = useCardPlacement(anchor)

  return createPortal(
    <div
      ref={ref}
      className="hover-card"
      data-testid={testId}
      // Not `role="tooltip"`: a tooltip is never interactive, and this card holds real buttons.
      role="dialog"
      aria-modal="false"
      aria-label={title}
      style={pos === null
        ? { visibility: 'hidden', left: 0, top: 0 }
        : { left: pos.left, top: pos.top }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      // Portal events bubble through the React tree to the row, whose "hide when clicked" handler
      // would unmount the card before a click on its button landed.
      onMouseDown={(e) => { e.stopPropagation() }}
    >
      <div className="hover-card-title">{title}</div>
      {note !== null && note !== undefined && note !== '' && (
        <div className="hover-card-note" data-testid="hover-card-note">
          <MrRefText text={note} statuses={noteMrStatuses ?? {}} />
        </div>
      )}
      <div className="hover-card-row hover-card-path-row">
        <span className="hover-card-path" data-testid="hover-card-path">{path}</span>
        <button
          className="hover-card-copy"
          data-testid="hover-card-copy-path"
          title={copied === 'path' ? 'Copied' : 'Copy path'}
          aria-label={`Copy path ${path}`}
          onClick={() => {
            void copyText(path).then((ok) => { if (ok) setCopied('path') })
          }}
        >
          {copied === 'path' ? <CheckIcon /> : <CopyIcon />}
        </button>
      </div>
      {missing === true && <div className="hover-card-missing">This folder no longer exists.</div>}
      {branch !== null && (
        <div className="hover-card-row">
          <span className="hover-card-label">Branch</span>
          <span className="hover-card-branch">{branch}</span>
          <button
            className="hover-card-copy"
            data-testid="hover-card-copy-branch"
            title={copied === 'branch' ? 'Copied' : 'Copy branch name'}
            aria-label={`Copy branch name ${branch}`}
            onClick={() => {
              void copyText(branch).then((ok) => { if (ok) setCopied('branch') })
            }}
          >
            {copied === 'branch' ? <CheckIcon /> : <CopyIcon />}
          </button>
          {onPullBranch !== undefined && (
            <button
              className="hover-card-copy"
              data-testid="hover-card-pull-branch"
              title={pulling ? 'Pulling…' : `Pull the latest ${branch} (fast-forward only)`}
              aria-label={`Pull the latest ${branch}`}
              aria-busy={pulling}
              disabled={pulling}
              onClick={() => {
                setPulling(true)
                void onPullBranch().finally(() => { setPulling(false) })
              }}
            >
              <ArrowDownIcon />
            </button>
          )}
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
      {canOpenInVsCode === true && (
        <button
          className="btn small hover-card-open-vscode"
          data-testid="hover-card-open-vscode"
          onClick={onOpenInVsCode}
        >
          Open in VS Code
        </button>
      )}
    </div>,
    document.body,
  )
}

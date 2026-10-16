import { type JSX, memo } from 'react'
import type { SessionNode } from '@shared/types'
import { NoteIcon, SplitIcon } from '../../ui/icons'
import { LayoutMenuButton, useLayoutActions } from '../layout'
import { SessionRowActions } from './SessionRowActions'
import { HoverCard } from '../../ui/HoverCard'
import { MrRefText } from '../../ui/mrRefText'
import { useHoverCard } from '../../ui/useHoverCard'
import { useVsCodeAvailable } from '../../state/vsCodeStore'
import { useMrStatuses } from './useMrStatuses'
import { relativeTime, fullTime } from '../../ui/format'
import { openSessionInVsCode } from '../../state/sessions'
interface Props {
  session: SessionNode
  selected: boolean
  pinned: boolean
  onSelect: (session: SessionNode) => void
  onSplit: (session: SessionNode) => void
  onDelete: (session: SessionNode) => void
  onTogglePin: (session: SessionNode) => void
  onEditNote: (session: SessionNode) => void
  /** Right-click. The menu belongs to the sidebar, the only thing that can position one over the
   *  whole pane rather than inside a clipped, scrolling row. */
  onMenu?: (session: SessionNode, x: number, y: number) => void
  /**
   * The branch the session's folder is on *now*, from the scan — the same value the session bar
   * shows. Distinct from `session.gitBranch`, the branch recorded in the JSONL when it ran.
   */
  folderBranch?: string | null
  /** Names the worktree a flat search result lives in, since there is no folder header above it. */
  subtitle?: string | null
  /**
   * Offers a "dismiss" action in the row's own button strip (Recent). Part of the strip, not a
   * button laid over the row: a full-size control on top of the layout button closed the layout
   * picker when the pointer crossed it.
   */
  onDismiss?: (session: SessionNode) => void
  /**
   * This row as a WAI-ARIA treeitem. `treeTabIndex` is the roving-tabindex value the containing
   * tree computed (0 for its one Tab stop, -1 otherwise); `treeLevel` is `aria-level`. Defaults
   * suit a row outside any tree: level 1, not a Tab stop.
   */
  treeTabIndex?: number
  treeLevel?: number
}

/**
 * The age and the row's buttons deliberately occupy the same space at the right-hand end, swapped
 * on hover, so neither gives up width (see `.session-row-wrap:hover .session-time` in styles.css).
 * The buttons are siblings of the row because a <button> cannot contain another interactive element.
 */
function SessionRowView({
  session, selected, pinned, onSelect, onSplit, onDelete, onTogglePin, onEditNote, onMenu,
  folderBranch, subtitle, onDismiss, treeTabIndex = -1, treeLevel = 1,
}: Props): JSX.Element {
  const hasNote = session.note !== null && session.note !== ''
  const { anchor: cardAnchor, ref: wrapRef, arm, keepOpen, scheduleClose, hideNow } =
    useHoverCard<HTMLDivElement>()

  const { place, isOpen } = useLayoutActions()
  const vsCodeAvailable = useVsCodeAvailable()
  const canOpenInVsCode = vsCodeAvailable && session.cwdExists

  // The hover card is pure display, so the `!<iid>` references are resolved here.
  const mrStatuses = useMrStatuses(session.sessionId, session.title)
  const noteMrStatuses = useMrStatuses(session.sessionId, session.note ?? '')

  return (
    <div
      className="session-row-wrap"
      data-pinned={pinned}
      data-session-id={session.sessionId}
      role="treeitem"
      // A stable name rather than the visible text, which changes when a note is added or the age
      // ticks over, so anything holding the old name could no longer find the row.
      aria-label={session.title}
      aria-selected={selected}
      aria-level={treeLevel}
      data-tree-kind="session"
      data-tree-key={session.sessionId}
      data-own-context-menu={onMenu === undefined ? undefined : true}
      tabIndex={treeTabIndex}
      ref={wrapRef}
      // A pinned row is already inside a draggable div (the pin-reorder gesture); a nested
      // draggable would win the native drag and break reordering. The pinned section mirrors a
      // folder row's session and is never a move target.
      draggable={!pinned}
      onDragStart={pinned ? undefined : (e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-apiary-session', session.sessionId)
      }}
      onContextMenu={(e) => {
        if (onMenu === undefined) return
        e.preventDefault()
        hideNow()
        onMenu(session, e.clientX, e.clientY)
      }}
      onMouseEnter={arm}
      onMouseLeave={scheduleClose}
      // Keyboard users reach the card through focus, with the hover timers. React's focus events
      // bubble like `focusin`, so focus on any inner button counts, and the grace period lets Tab
      // move into the card's own buttons.
      onFocus={arm}
      onBlur={scheduleClose}
      onMouseDown={hideNow}
    >
      {cardAnchor !== null && (
        <HoverCard
          anchor={cardAnchor}
          title={session.title}
          path={session.cwd}
          branch={folderBranch ?? session.gitBranch}
          /* Only when it differs from where the folder is now: two "Branch" labels with different
           * values read as a contradiction, so the card leads with the live one. */
          recordedBranch={
            folderBranch !== undefined && folderBranch !== null
            && session.gitBranch !== null && session.gitBranch !== folderBranch
              ? session.gitBranch
              : null
          }
          note={session.note}
          noteMrStatuses={noteMrStatuses}
          lastActive={session.lastActiveAtMs === null ? null : fullTime(session.lastActiveAtMs)}
          missing={!session.cwdExists}
          canOpenInVsCode={canOpenInVsCode}
          onOpenInVsCode={() => {
            openSessionInVsCode(session.sessionId)
          }}
          onPointerEnter={keepOpen}
          onPointerLeave={scheduleClose}
        />
      )}
      <button
        className="session-row"
        data-testid="session-item"
        data-selected={selected}
        data-live={session.isLive}
        // The wrap is the treeitem with the roving tabindex; a Tab stop here too would reach
        // every row twice.
        tabIndex={-1}
        onClick={() => onSelect(session)}
      >
        {session.isLive && <span className="live-dot" aria-label="running" />}
        <span className="session-title">
          <MrRefText text={session.title} statuses={mrStatuses} />
        </span>
        {subtitle !== null && subtitle !== undefined && <span className="session-subtitle" data-testid="session-subtitle">{subtitle}</span>}
        {hasNote && (
          <span className="session-note-mark" data-testid="session-note-mark" aria-label="has a note">
            <NoteIcon filled />
          </span>
        )}
        {!session.cwdExists && <span className="missing">folder gone</span>}
        <span className="session-time" data-testid="session-time">{relativeTime(session.lastActiveAtMs)}</span>
      </button>
      <SessionRowActions
        session={session} pinned={pinned} hasNote={hasNote} onDelete={onDelete}
        onTogglePin={onTogglePin} onEditNote={onEditNote} onDismiss={onDismiss}
        splitButton={
          <LayoutMenuButton
            className="row-action"
            testId="split-session-button"
            title="Open to the side — rest here for layouts"
            ariaLabel={`Open session ${session.title} to the side`}
            heading={isOpen(session.sessionId) ? `Move “${session.title}” here` : `Open “${session.title}” here`}
            onClick={() => { onSplit(session) }}
            // The row's own hover card is still up when the pointer reaches this button — it opened on
            // the way past. Two overlapping popups from one movement is unreadable, so the card yields.
            onOpen={hideNow}
            onPick={(preset, zone) => { hideNow(); place({ kind: 'session', session }, preset, zone) }}
            tabIndex={-1}
          >
            <SplitIcon />
          </LayoutMenuButton>
        }
      />
    </div>
  )
}

/**
 * Memoized: a sidebar render caused by something the row does not show — an activity
 * broadcast changing `activeTabs`, a search keystroke settling — hands every row the same props
 * (callbacks come from `Sidebar`'s `rowActions`, which only changes when one of them does), so
 * only a row whose own session, selection or tab stop changed re-renders.
 */
export const SessionRow = memo(SessionRowView)

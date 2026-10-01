import { type JSX, memo, useEffect, useState } from 'react'
import type { SessionNode } from '@shared/types'
import { CloseIcon, NoteIcon, PinIcon, SplitIcon, TrashIcon } from '../../ui/icons'
import { HoverCard } from '../../ui/HoverCard'
import { MrRefText } from './mrRefText'
import { useHoverCard } from '../../ui/useHoverCard'
import { useMrStatuses } from './useMrStatuses'
import { LayoutMenuButton } from '../layout/LayoutMenuButton'
import { useLayoutActions } from '../layout/layoutContext'
import { useNotifications } from '../../ui/notifications'
import { relativeTime, fullTime } from '../../ui/format'

/**
 * Whether VS Code was found, read once for every row rather than once per row: main-process
 * detection runs a single time at startup and never changes, so a hundred rows each awaiting
 * their own `ipcRenderer.invoke` would be a hundred round trips for one fact. The first row to
 * mount starts the lookup; every other row (mounted before or after) shares its result.
 */
let vsCodeAvailable: boolean | null = null
let vsCodeAvailablePromise: Promise<boolean> | null = null
function loadVsCodeAvailable(): Promise<boolean> {
  // Caches the resolved value even on failure (UI-23): without the catch, a rejection left
  // `vsCodeAvailablePromise` pointing at a rejected promise forever, and every row mounted after
  // that (`.then` below, with no catch of its own) produced its own unhandled rejection — one per
  // row in a long list, all for the same single failed lookup.
  vsCodeAvailablePromise ??= window.apiary.vsCodeAvailable()
    .then((v) => { vsCodeAvailable = v; return v })
    .catch(() => { vsCodeAvailable = false; return false })
  return vsCodeAvailablePromise
}

interface Props {
  session: SessionNode
  selected: boolean
  pinned: boolean
  onSelect: (session: SessionNode) => void
  onSplit: (session: SessionNode) => void
  onDelete: (session: SessionNode) => void
  onTogglePin: (session: SessionNode) => void
  /** Opens the note editor for this session. */
  onEditNote: (session: SessionNode) => void
  /** Right-click. The menu itself belongs to the sidebar, which is the only thing that can
   *  position one over the whole pane rather than inside a clipped, scrolling row. */
  onMenu?: (session: SessionNode, x: number, y: number) => void
  /**
   * The branch the session's folder is on *now*, from the scan — the same value the session bar
   * shows. Distinct from `session.gitBranch`, which is the branch recorded in the JSONL at the
   * time the session ran and can be months out of date.
   */
  folderBranch?: string | null
  /** Shown under the title instead of the row's usual folder-branch tooltip context — the flat
   *  search list's way of saying which worktree a result lives in, since there is no folder header
   *  above it to say so. */
  subtitle?: string | null
  /**
   * Offers a "dismiss" action in the row's own button strip — the Recent section's way of letting
   * a session drop out of the list. Part of the strip rather than a button laid over the row: laid
   * over it, a full-size control sat on top of the layout button, and the pointer crossing it on
   * the way to the layout picker closed the picker.
   */
  onDismiss?: (session: SessionNode) => void
  /**
   * UI-27: this row as a WAI-ARIA treeitem. `treeTabIndex` is the roving-tabindex value the
   * containing tree computed (0 for the tree's one Tab stop, -1 otherwise) — the row itself has no
   * way to know that on its own, since it depends on what else is focused in the same tree.
   * `treeLevel` is `aria-level`; both default to values that make sense for a row rendered outside
   * any tree at all (a plain list item, level 1, not a Tab stop of its own — callers that do want
   * one pass 0 explicitly).
   */
  treeTabIndex?: number
  treeLevel?: number
}

/**
 * One session in the sidebar — used both inside its folder in the tree and, unchanged, in the
 * pinned section above it, so a pinned session looks and behaves exactly like the row it was
 * pinned from.
 *
 * The age and the row's buttons deliberately occupy the *same* space at the right-hand end: the
 * age is what you want while scanning the list, the buttons only once you have settled on a row,
 * and swapping one for the other on hover means neither has to give up width to the other (see
 * `.session-row-wrap:hover .session-time` in styles.css). The buttons are siblings of the row
 * rather than children of it because a <button> cannot contain another interactive element.
 */
function SessionRowView({
  session, selected, pinned, onSelect, onSplit, onDelete, onTogglePin, onEditNote, onMenu,
  folderBranch, subtitle, onDismiss, treeTabIndex = -1, treeLevel = 1,
}: Props): JSX.Element {
  const hasNote = session.note !== null && session.note !== ''
  const { anchor: cardAnchor, ref: wrapRef, arm, keepOpen, scheduleClose, hideNow } =
    useHoverCard<HTMLDivElement>()
  const { place, isOpen } = useLayoutActions()
  const { notifyError } = useNotifications()

  const [canOpenInVsCode, setCanOpenInVsCode] = useState(vsCodeAvailable ?? false)
  useEffect(() => {
    if (vsCodeAvailable !== null) { setCanOpenInVsCode(vsCodeAvailable && session.cwdExists); return }
    void loadVsCodeAvailable().then((v) => { setCanOpenInVsCode(v && session.cwdExists) })
  }, [session.cwdExists])

  // Resolves `!<iid>` references named in the title and the note independently, so the hover
  // card — a pure display component with no IPC calls of its own — is simply handed the answer.
  const mrStatuses = useMrStatuses(session.sessionId, session.title)
  const noteMrStatuses = useMrStatuses(session.sessionId, session.note ?? '')

  return (
    <div
      className="session-row-wrap"
      data-pinned={pinned}
      data-session-id={session.sessionId}
      role="treeitem"
      // A stable name rather than the row's full visible text (title, relative age, "has a note"):
      // without it, the row's accessible name changed under a test (or a screen reader) the moment
      // a note was added or the age ticked over, and anything holding onto that name — including
      // the component-test harness's own element-to-locator resolution for `userEvent.hover` —
      // could no longer find the row it already had a reference to.
      aria-label={session.title}
      aria-selected={selected}
      aria-level={treeLevel}
      data-tree-kind="session"
      data-tree-key={session.sessionId}
      tabIndex={treeTabIndex}
      ref={wrapRef}
      // A pinned row is already wrapped in its own draggable div (the pin-reorder gesture — see
      // Sidebar.tsx); nesting a second draggable element inside it would make a native drag pick
      // the innermost one and silently break reordering, since only one `dragstart` ever fires
      // for a real mouse drag. The pinned section is never a valid move target anyway (it mirrors
      // a folder row's session, it is not one), so the move gesture only makes sense here.
      draggable={!pinned}
      onDragStart={pinned ? undefined : (e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('application/x-apiary-session', session.sessionId)
      }}
      onContextMenu={(e) => {
        if (onMenu === undefined) return
        e.preventDefault()
        // The hover card would otherwise sit over the menu that was just asked for.
        hideNow()
        onMenu(session, e.clientX, e.clientY)
      }}
      onMouseEnter={arm}
      onMouseLeave={scheduleClose}
      // UI-26: a keyboard user Tabbing through the row's own buttons (open, note, pin, split,
      // delete) could never reach the card at all — it opened only on `mouseenter`. `onFocus`/
      // `onBlur` on the wrap reuse the exact same arm/close timers a mouse hover does (React's
      // synthetic focus events bubble like `focusin`/`focusout`, so this fires for focus landing on
      // any button inside, not just the wrap itself), including the short grace period that lets
      // Tab move from the row into the card's own buttons without it closing first.
      onFocus={arm}
      onBlur={scheduleClose}
      // Any click hides it: the card is for deciding which row you want, and it has no business
      // sitting over the session you just opened.
      onMouseDown={hideNow}
    >
      {cardAnchor !== null && (
        <HoverCard
          anchor={cardAnchor}
          title={session.title}
          path={session.cwd}
          branch={folderBranch ?? session.gitBranch}
          /*
           * Only when it differs from where the folder is now. Reported as a contradiction: the
           * card said `dev/1.0.12` while the bar under the session said `dev/1.0.11`, both
           * labelled "Branch". They were two different facts — the branch the session was recorded
           * on, and the branch its worktree is checked out to today — so the card now leads with
           * the live one and names the other for what it is.
           */
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
            window.apiary.openInVsCode({ kind: 'session', id: session.sessionId }).catch((e: unknown) => {
              notifyError(e, 'Could not open VS Code')
            })
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
        // UI-27: the row itself is a WAI-ARIA treeitem (the wrap, above) with its own roving
        // tabindex; this inner button stays clickable but is not a Tab stop of its own, or Tab
        // would reach every row a second time on top of the tree's own Up/Down navigation.
        tabIndex={-1}
        onClick={() => onSelect(session)}
      >
        {session.isLive && <span className="live-dot" aria-label="running" />}
        <span className="session-title">
          <MrRefText text={session.title} statuses={mrStatuses} />
        </span>
        {subtitle !== null && subtitle !== undefined && <span className="session-subtitle" data-testid="session-subtitle">{subtitle}</span>}
        {hasNote && (
          // Marked in the row itself, not only in the actions: which sessions you have annotated
          // is worth knowing while scanning the list, and the actions only appear on hover.
          <span className="session-note-mark" data-testid="session-note-mark" aria-label="has a note">
            <NoteIcon filled />
          </span>
        )}
        {!session.cwdExists && <span className="missing">folder gone</span>}
        <span className="session-time" data-testid="session-time">{relativeTime(session.lastActiveAtMs)}</span>
      </button>
      <button
        className="row-action note-session-button"
        data-testid="note-session-button"
        data-has-note={hasNote}
        title={hasNote ? 'Edit this session\u2019s note' : 'Add a note to this session'}
        aria-label={`${hasNote ? 'Edit' : 'Add'} note for session ${session.title}`}
        // UI-27 step 1: row-action buttons are not Tab stops (with 500 sessions that would be
        // 2000+ of them); the row's own context menu (Shift+F10 / the Menu key, wired at the
        // tree's root) offers the same actions.
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onEditNote(session) }}
      >
        <NoteIcon filled={hasNote} />
      </button>
      <button
        className="row-action pin-session-button"
        data-testid="pin-session-button"
        data-pinned={pinned}
        title={pinned ? 'Unpin this session' : 'Pin this session'}
        aria-label={`${pinned ? 'Unpin' : 'Pin'} session ${session.title}`}
        aria-pressed={pinned}
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onTogglePin(session) }}
      >
        <PinIcon filled={pinned} />
      </button>
      <LayoutMenuButton
        className="row-action split-session-button"
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
      <button
        className="row-action delete-session-button"
        data-testid="delete-session-button"
        title="Remove this session"
        aria-label={`Remove session ${session.title}`}
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); onDelete(session) }}
      >
        <TrashIcon />
      </button>
      {onDismiss !== undefined && (
        <button
          className="row-action recent-dismiss"
          data-testid="recent-dismiss-button"
          title="Dismiss from Recent"
          aria-label={`Dismiss ${session.title} from Recent`}
          tabIndex={-1}
          onClick={(e) => { e.stopPropagation(); onDismiss(session) }}
        >
          <CloseIcon />
        </button>
      )}
    </div>
  )
}

/**
 * Memoized (UI-4): a sidebar render caused by something the row does not show — an activity
 * broadcast changing `activeTabs`, a search keystroke settling — hands every row the same props
 * (callbacks come from `Sidebar`'s `rowActions`, which only changes when one of them does), so
 * only a row whose own session, selection or tab stop changed re-renders.
 */
export const SessionRow = memo(SessionRowView)

import { useDeferredValue, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import type { ActiveTabPayload } from '@shared/api'
import { describeActivityStatus } from '@shared/activity'
import { useTree } from '../state/useTree'
import { rankSessions } from '@shared/sessionRank'
import { SEARCH_RESULT_CAP } from '@shared/treeFilter'
import { SessionTree } from './SessionTree'
import { SessionRow } from './SessionRow'
import { MrRefText } from './mrRefText'
import { useMrStatuses } from './useMrStatuses'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import {
  groupFolders, orderFolders, moveFolder, moveGroup, moveGroupBefore, deleteGroup, newGroupId,
  type GroupState,
} from '../state/groups'
import { selectRecent, type DismissedMap } from '../state/recentSessions'
import { CloseIcon, RefreshIcon, SidebarIcon } from './icons'
import { SearchField } from './SearchField'
import { useNotifications } from '../state/notifications'
import { describeRefresh } from '../state/refreshSummary'
import { useLayoutActions } from '../state/layoutContext'
import { ActivityLegend } from './ActivityLegend'

/** How many sessions the tree holds, at any depth. */
function countSessions(nodes: ProjectNode[]): number {
  return nodes.reduce((n, node) => n + node.sessions.length + countSessions(node.children), 0)
}

/** Every session anywhere in the tree, flattened, so pinned ids can be resolved back to rows. */
function flattenSessions(nodes: ProjectNode[], into = new Map<string, SessionNode>()): Map<string, SessionNode> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, s)
    flattenSessions(node.children, into)
  }
  return into
}

/**
 * Each session's *folder* branch, by session id.
 *
 * The pinned section draws rows outside the tree that holds them, so the project node — and with
 * it the branch its worktree is on — is not to hand. The lookup is built alongside the flatten.
 */
function folderBranches(nodes: ProjectNode[], into = new Map<string, string | null>()): Map<string, string | null> {
  for (const node of nodes) {
    for (const s of node.sessions) into.set(s.sessionId, node.branch)
    folderBranches(node.children, into)
  }
  return into
}

/** A new-session pty still awaiting its first JSONL — see `PendingSession` in App.tsx. Listed so
 *  a pending session other than the one currently shown can still be reached and switched back to,
 *  rather than being silently unreachable while it resolves in the background. */
export interface PendingSessionSummary {
  ptyId: string
  label: string
  cwd: string
}

interface Props {
  /** Folded away to the rail. Kept mounted meanwhile — see App. */
  hidden?: boolean
  onHide?: () => void
  /** The hide button's tooltip, which names the platform's shortcut. */
  hideTitle?: string
  selectedId: string | null
  onSelect: (session: SessionNode) => void
  /** Paths of folders currently collapsed. Anything not in this set is open, including a
   * folder that has never been seen before — so new folders open by default without any
   * separate "seen before" tracking. */
  collapsed: Set<string>
  onCollapsedChange: (next: Set<string>) => void
  /** Starts a brand-new Claude Code session in a project's folder. */
  onNewSession: (path: string) => void
  /** Asks to remove a session from view. */
  onDeleteSession: (session: SessionNode) => void
  /** Opens a session in a column of its own beside the current one. */
  onSplitSession: (session: SessionNode) => void
  /** Session ids the user has pinned, most recently pinned first. */
  pinned: string[]
  onTogglePin: (session: SessionNode) => void
  /** Opens the note editor for a session. */
  onEditNote: (session: SessionNode) => void
  /** Starts a fork of a session: a new conversation seeded with this one's. */
  onForkSession: (sessionId: string) => void
  /** Whether the pinned section is collapsed — persisted, like the folder collapse state. */
  pinnedCollapsed: boolean
  onPinnedCollapsedChange: (next: boolean) => void
  /** New-session ptys not yet resolved into a real SessionNode, excluding whichever one (if any)
   * is already the one shown in the main pane — so this lists only the ones a click would
   * actually switch to. */
  pending: PendingSessionSummary[]
  /** Switches the main pane to a pending session's terminal. */
  onSelectPending: (ptyId: string) => void
  /**
   * A session to scroll into view, set when its tab is activated (Settings > Sidebar). Changing
   * this is the whole signal: it is deliberately not the same as `selectedId`, so that merely
   * re-rendering with a selection does not yank the list around while you are scrolling it by hand.
   */
  revealId: string | null
  /** The user's own arrangement of the top level: named groups, assignments, and folder order. */
  groupState: GroupState
  onGroupStateChange: (next: GroupState) => void
  /** Reorders the pinned section by dropping one pinned session onto another. */
  onReorderPinned: (id: string, beforeId: string) => void
  /** Whether the Recent section is shown at all — Settings > Sidebar. */
  recentSectionEnabled: boolean
  /** How far back, in hours, "recent" looks — Settings > Sidebar. */
  recentSectionHours: number
  /** sessionId -> dismissedAtMs, shared like `pinned` — see state/recentSessions.ts. */
  dismissedRecent: DismissedMap
  /** Whether the Recent section itself is collapsed — persisted, like the pinned section's. */
  recentCollapsed: boolean
  onRecentCollapsedChange: (next: boolean) => void
  /** Hides a session from Recent until it is used again. */
  onDismissRecent: (session: SessionNode) => void
  /** Every open tab across every window, for the Active section above Pinned. */
  activeTabs: ActiveTabPayload[]
  /** Raises the window showing a tab and switches it to that tab. */
  onFocusTab: (windowNumber: number, key: string) => void
  /** Search conversation contents as well as titles — Settings > Search. */
  searchChatContent: boolean
  /** Search the notes people write on sessions — Settings > Search. */
  searchSessionNotes: boolean
  /** A session row was dropped on a folder — the drag-to-move gesture. Resolved here to the
   *  `SessionNode` the tree already holds, so the caller only ever deals in sessions, not ids. */
  onSessionDropped: (session: SessionNode, toPath: string) => void
}

/**
 * The chain of folder paths leading to a session, outermost first.
 *
 * Revealing a session means nothing while the folder holding it is collapsed — the row does not
 * exist to scroll to. These are the folders that have to be opened for it to.
 */
/** Every folder path in the tree, at every depth — the full list ordering is resolved against. */
function allFolderPaths(nodes: ProjectNode[]): string[] {
  return nodes.flatMap((n) => [n.path, ...allFolderPaths(n.children)])
}

function pathsToSession(nodes: ProjectNode[], id: string, trail: string[] = []): string[] | null {
  for (const node of nodes) {
    const here = [...trail, node.path]
    if (node.sessions.some((s) => s.sessionId === id)) return here
    const deeper = pathsToSession(node.children, id, here)
    if (deeper) return deeper
  }
  return null
}

/**
 * An Active row's title, with any `!<iid>` in it resolved to its merge-request state.
 *
 * Its own component because the lookup is a hook, and the rows are produced in a `map` inside
 * `Sidebar` where a hook cannot go. Active is the section meant to be read at a glance without
 * opening anything, so it is the last place that should be showing a staler title than the tree.
 */
function ActiveTabTitle({ sessionId, title }: { sessionId: string; title: string }): JSX.Element {
  const statuses = useMrStatuses(sessionId, title)
  return <span className="session-title"><MrRefText text={title} statuses={statuses} /></span>
}

export function Sidebar({
  hidden = false, onHide, hideTitle = 'Hide sidebar',
  selectedId, onSelect, collapsed, onCollapsedChange, onNewSession, onDeleteSession,
  onSplitSession, pinned, onTogglePin, onEditNote, onForkSession, pinnedCollapsed,
  onPinnedCollapsedChange,
  pending, onSelectPending, revealId, groupState, onGroupStateChange, onReorderPinned,
  recentSectionEnabled, recentSectionHours, dismissedRecent, recentCollapsed,
  onRecentCollapsedChange, onDismissRecent, activeTabs, onFocusTab,
  searchChatContent, searchSessionNotes, onSessionDropped,
}: Props): JSX.Element {
  /** The settled query — `SearchField` publishes it once typing pauses, never per keystroke. */
  const [query, setQuery] = useState('')
  /**
   * The query the expensive work runs against.
   *
   * `useDeferredValue` lets React treat filtering, ranking and rendering several hundred rows as
   * interruptible, lower-priority work. If another keystroke settles while a big list is still
   * rendering, React abandons that render and starts the newer one instead of finishing work
   * nobody will see — and the search box, which is ordinary priority, stays responsive throughout.
   */
  const deferredQuery = useDeferredValue(query)
  const { tree, rawTree, settledQuery, matchedByContent, capped, loading, reload, reloadNow } = useTree(deferredQuery, {
    searchChatContent, searchSessionNotes,
  })
  const { notify, notifyError } = useNotifications()
  const { requestPicker } = useLayoutActions()
  const [refreshing, setRefreshing] = useState(false)
  const listRef = useRef<HTMLDivElement | null>(null)

  /**
   * Scrolls a revealed session's row into view, opening the folders above it first.
   *
   * Re-runs on tree and collapse changes as well as on `revealId`, because the row usually is not
   * rendered at the moment the reveal is asked for: the tree arrives asynchronously, and a folder
   * may need opening before the row exists at all. Each pass does the next thing it can and lets
   * the resulting render bring it back.
   *
   * `scrolledTo` is what stops it fighting the user: once a session has been scrolled to, later
   * renders leave the list alone, so a tree refresh while you are scrolling by hand does not yank
   * you back. `block: 'nearest'` likewise leaves an already-visible row exactly where it is.
   */
  const scrolledTo = useRef<string | null>(null)
  /**
   * Which session the folders have already been opened for.
   *
   * Separate from `scrolledTo`, and the reason a folder can be collapsed at all. The expand step
   * re-runs on every `collapsed` change, and collapsing a folder *is* a `collapsed` change — so
   * with only the scroll latch to stop it, a click on the chevron of the folder holding the open
   * session was undone by the very render it caused. The folder shut and sprang back open, which
   * is exactly what "clicking B or C won't collapse that folder" looked like from outside, and
   * why turning the setting off appeared to fix it.
   *
   * Revealing is a response to the *selection changing*, not a standing rule that the selected
   * session's folders stay open. Once this has opened them for a given id, the user's own
   * collapsing wins until a different session is revealed. The scroll below still retries, since
   * it is what has to wait for the row to exist.
   */
  const expandedFor = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (revealId === null || scrolledTo.current === revealId) return

    const chain = pathsToSession(tree, revealId)
    if (chain !== null && expandedFor.current !== revealId && chain.some((path) => collapsed.has(path))) {
      expandedFor.current = revealId
      const next = new Set(collapsed)
      for (const path of chain) next.delete(path)
      onCollapsedChange(next)
      return
    }

    const row = listRef.current?.querySelector(`[data-session-id="${CSS.escape(revealId)}"]`)
    if (!row) return
    row.scrollIntoView({ block: 'nearest' })
    scrolledTo.current = revealId
  }, [revealId, tree, collapsed, onCollapsedChange])

  const isEmpty = useMemo(() => !loading && tree.length === 0, [loading, tree])

  /**
   * Pinned rows, in the order they were pinned rather than the order the tree happens to hold
   * them. Resolved against the *filtered* tree, so a search narrows the pinned section too —
   * a pinned session that doesn't match what you typed would otherwise be the one row on screen
   * that ignores the search box.
   */
  const pinnedSet = useMemo(() => new Set(pinned), [pinned])
  const branchOfSession = useMemo(() => folderBranches(tree), [tree])
  const sessionsById = useMemo(() => flattenSessions(tree), [tree])
  const pinnedSessions = useMemo(() => {
    return pinned.map((id) => sessionsById.get(id)).filter((s): s is SessionNode => s !== undefined)
  }, [sessionsById, pinned])

  /** Keys of every tab the Active section is already showing, so Recent never repeats one. */
  const activeIds = useMemo(() => new Set(activeTabs.map((t) => t.key)), [activeTabs])
  /** The Active header's rect while the pointer (or focus) is on it — see ActivityLegend. */
  const [legendAnchor, setLegendAnchor] = useState<DOMRect | null>(null)

  /**
   * Every session known anywhere, unfiltered — what the Active section resolves its titles
   * against. Using the search-filtered `sessionsById` here would turn a row for a tab open in
   * *another* window into a bare, unreadable session id the moment this window's own search box
   * happens to exclude that tab's project, which defeats the whole point of resolving a title in
   * the first place.
   */
  const activeSessionsById = useMemo(() => flattenSessions(rawTree), [rawTree])

  /**
   * Recent, resolved against the same filtered tree pinned is — a search narrows this section too.
   * `activeIds` keeps Recent from repeating a session Active already shows.
   */
  const recentSessions = useMemo(() => {
    if (!recentSectionEnabled) return []
    return selectRecent(
      Array.from(sessionsById.values()), pinnedSet, activeIds, dismissedRecent, Date.now(), recentSectionHours,
    )
  }, [sessionsById, pinnedSet, activeIds, dismissedRecent, recentSectionEnabled, recentSectionHours])

  const toggle = (path: string): void => {
    const next = new Set(collapsed)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    onCollapsedChange(next)
  }

  /**
   * The top level, as the user arranged it: their groups first, then everything ungrouped.
   *
   * Searching deliberately bypasses the arrangement — while a query is on, the tree is already a
   * filtered subset, and hiding matches inside collapsed groups would defeat the point of typing.
   */
  // Keyed on the deferred query so what is on screen is always internally consistent: the flat
  // results list appears with the results, not a moment before them.
  const searching = deferredQuery.trim() !== ''
  const arranged = useMemo(
    () => groupFolders(tree, (n) => n.path, groupState.groups, groupState.assignments, groupState.folderOrder),
    [tree, groupState],
  )
  const groupsCollapsed = useMemo(() => new Set(groupState.collapsed), [groupState.collapsed])

  /**
   * The flat, ranked results shown while searching — ranked over every match `tree` holds (which
   * is uncapped; see `filterTreeLocal`), with the cap applied here, to the *ranked* list, so the
   * best matches survive it rather than whichever `SEARCH_RESULT_CAP` sessions a folder walk
   * happened to reach first. Memoized because `rankSessions` now runs over the full match set —
   * unbounded by the old pre-rank cap — and re-ranking on every unrelated render (an Active-section
   * poll, a git-status refresh) would reintroduce exactly the per-render cost this feature exists
   * to avoid.
   *
   * Keyed on `settledQuery`, never the live `query`. Keying on the live one made the memo miss on
   * every keystroke while `tree` still held the *previous* query's matches — so each character
   * typed re-ranked the widest match set there is (a one-character query matches nearly every
   * session), synchronously, before the character could be painted, and then ranked it again when
   * the debounce settled. That was the beach ball: typing the second letter of a search stalled
   * the whole window.
   */
  const rankedResults = useMemo(
    () => rankSessions(tree, settledQuery, matchedByContent)
      // Pinned matches are already on screen in the Pinned section above, which a search narrows
      // the same way it narrows this list — so leaving them in showed the same session twice. The
      // tree does exactly this (`SessionTree` renders only a folder's unpinned sessions); the flat
      // results list simply never learned to. Filtered before the cap, so excluding a pinned row
      // gives its place back to the next-best match rather than shortening the list.
      .filter(({ session }) => !pinnedSet.has(session.sessionId))
      .slice(0, SEARCH_RESULT_CAP),
    [tree, settledQuery, matchedByContent, pinnedSet],
  )

  /** Which menu is open, if any: a right-click on a folder, or on a group's header. */
  const [menu, setMenu] = useState<
    { kind: 'folder' | 'group' | 'session'; id: string; x: number; y: number } | null
  >(null)
  /** The group a folder is currently being dragged over, so the whole section can light up. */
  const [dropIntoGroup, setDropIntoGroup] = useState<string | null>(null)
  /** A group whose name is being edited in place, instead of through a modal. */
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const patchGroups = (next: Partial<GroupState>): void => {
    onGroupStateChange({ ...groupState, ...next })
  }

  const assignFolder = (path: string, groupId: string | null): void => {
    const assignments = { ...groupState.assignments }
    if (groupId === null) delete assignments[path]
    else assignments[path] = groupId
    patchGroups({ assignments })
  }

  const startNewGroup = (withFolder: string): void => {
    const group = { id: newGroupId(), name: 'New group' }
    onGroupStateChange({
      ...groupState,
      groups: [...groupState.groups, group],
      assignments: { ...groupState.assignments, [withFolder]: group.id },
    })
    // Straight into rename, so naming it is the same gesture as making it rather than a second one.
    setRenamingGroup(group.id)
    setRenameDraft('New group')
  }

  const commitRename = (id: string): void => {
    const name = renameDraft.trim()
    setRenamingGroup(null)
    if (name === '') return
    patchGroups({ groups: groupState.groups.map((g) => (g.id === id ? { ...g, name } : g)) })
  }

  const menuItems = (): ContextMenuItem[] => {
    if (menu === null) return []
    if (menu.kind === 'session') {
      const session = flattenSessions(tree).get(menu.id)
      return [
        {
          id: 'fork-session',
          label: 'Fork session',
          run: () => onForkSession(menu.id),
        },
        {
          id: 'arrange',
          label: 'Arrange…',
          disabled: session === undefined,
          run: () => { if (session !== undefined) requestPicker({ kind: 'session', session }, { x: menu.x, y: menu.y }) },
        },
      ]
    }
    if (menu.kind === 'folder') {
      const current = groupState.assignments[menu.id]
      return [
        { id: 'new-group', label: 'New group from this folder…', run: () => startNewGroup(menu.id) },
        ...groupState.groups
          .filter((g) => g.id !== current)
          .map((g) => ({ id: `move-${g.id}`, label: `Add to “${g.name}”`, run: () => assignFolder(menu.id, g.id) })),
        {
          id: 'remove-from-group',
          label: 'Remove from group',
          disabled: current === undefined,
          separator: true,
          run: () => assignFolder(menu.id, null),
        },
      ]
    }
    const index = groupState.groups.findIndex((g) => g.id === menu.id)
    return [
      {
        id: 'rename-group',
        label: 'Rename group…',
        run: () => {
          setRenamingGroup(menu.id)
          setRenameDraft(groupState.groups[index]?.name ?? '')
        },
      },
      { id: 'group-up', label: 'Move group up', disabled: index <= 0, run: () => patchGroups({ groups: moveGroup(groupState.groups, menu.id, -1) }) },
      {
        id: 'group-down',
        label: 'Move group down',
        disabled: index === -1 || index >= groupState.groups.length - 1,
        run: () => patchGroups({ groups: moveGroup(groupState.groups, menu.id, 1) }),
      },
      {
        id: 'delete-group',
        label: 'Delete group',
        separator: true,
        // The folders inside come back out as ungrouped: deleting a heading must never look like
        // deleting the things filed under it.
        run: () => {
          const next = deleteGroup(groupState.groups, groupState.assignments, menu.id)
          patchGroups({ groups: next.groups, assignments: next.assignments })
        },
      },
    ]
  }

  /** The folders a group can hold: groups are a top-level arrangement, worktrees are not in them. */
  const topLevelPaths = new Set(tree.map((n) => n.path))

  const reorderFolder = (path: string, beforePath: string): void => {
    patchGroups({
      folderOrder: moveFolder(groupState.folderOrder, allFolderPaths(tree), path, beforePath),
    })
    // Dropping a top-level folder onto another files it into that one's group too, which is the
    // other half of what dragging it means. Nested folders (a repository's worktrees) are not in
    // groups at all, so this only applies where both are top level.
    if (!topLevelPaths.has(path) || !topLevelPaths.has(beforePath)) return
    const target = groupState.assignments[beforePath]
    if (target !== groupState.assignments[path]) assignFolder(path, target ?? null)
  }

  /** The tree props every level shares, so the grouped and ungrouped renders cannot drift apart. */
  const treeProps = {
    collapsed,
    onToggle: toggle,
    selectedId,
    onSelect,
    onNewSession,
    onDeleteSession,
    onSplitSession,
    pinned: pinnedSet,
    onTogglePin,
    onEditNote,
    onReorderFolder: reorderFolder,
    onFolderMenu: (path: string, x: number, y: number) => setMenu({ kind: 'folder', id: path, x, y }),
    onSessionMenu: (s: SessionNode, x: number, y: number) =>
      setMenu({ kind: 'session', id: s.sessionId, x, y }),
    // Resolved against the unfiltered tree — a session being dragged is on screen and therefore in
    // `tree` too, but there is no reason to make this depend on the search box being empty.
    onSessionDrop: (sessionId: string, folderPath: string) => {
      const session = activeSessionsById.get(sessionId)
      if (session !== undefined) onSessionDropped(session, folderPath)
    },
    orderFolders: (nodes: ProjectNode[]) => orderFolders(nodes, (n) => n.path, groupState.folderOrder),
    onCollapseBeneath: (path: string, beneath: string[]) => {
      const next = new Set(collapsed)
      for (const p of beneath) next.add(p)
      // Opened, if it was not: collapsing what is inside a closed folder would look like nothing
      // happened, and the list of worktrees is what the click is asking to see.
      next.delete(path)
      onCollapsedChange(next)
    },
  }

  return (
    <aside className="sidebar" data-testid="sidebar" ref={listRef} hidden={hidden}>
      <div className="sidebar-header">
        {onHide !== undefined && (
          // First in the row, at the edge it folds towards — where the rail's button that brings it
          // back will be, so hiding and showing is the same spot under the pointer.
          <button
            className="icon-button sidebar-hide"
            data-testid="sidebar-hide"
            title={hideTitle}
            aria-label="Hide sidebar"
            onClick={onHide}
          >
            <SidebarIcon />
          </button>
        )}
        {/* Owns the typed text itself, so a keystroke re-renders the box and nothing else — see
         *  SearchField. `resultsFor` is the query the rows below actually correspond to, which is
         *  what tells the field whether it is still catching up. */}
        <SearchField onChange={setQuery} resultsFor={deferredQuery} />
        <button
          className="icon-button sidebar-refresh"
          data-testid="sidebar-refresh"
          data-refreshing={refreshing}
          disabled={refreshing}
          onClick={() => {
            // What the list holds before the rescan, so the notification afterwards can say what
            // the rescan actually found rather than only that it happened.
            const before = countSessions(tree)
            setRefreshing(true)
            void window.apiary.refresh()
              .then(reloadNow)
              .then((next) => {
                notify({ message: describeRefresh(before, countSessions(next), deferredQuery.trim() !== '') })
              })
              .catch((e: unknown) => { reload(); notifyError(e, 'Could not rescan sessions') })
              .finally(() => setRefreshing(false))
          }}
          title="Refresh"
        >
          {/* The icon spins in place while a refresh is in flight; the label never leaves, so the
           *  button's own width stays put instead of visibly collapsing to a bare glyph. */}
          <RefreshIcon className={refreshing ? 'spinner' : undefined} />
          <span>Refresh</span>
        </button>
      </div>

      {isEmpty && deferredQuery.trim() === '' && (
        <p className="empty" data-testid="sidebar-empty">
          No sessions imported yet.
          <br />
          Use <strong>File &gt; Import Claude Sessions</strong> to choose which ones to show.
          <br />
          <span className="muted">
            Apiary reads ~/.claude/projects, or CLAUDE_CONFIG_DIR when that is set.
          </span>
        </p>
      )}

      {isEmpty && deferredQuery.trim() !== '' && (
        <p className="empty" data-testid="sidebar-no-matches">No sessions match that search.</p>
      )}

      {capped && (
        <p className="search-cap-note muted" data-testid="search-cap-note">
          Showing first {SEARCH_RESULT_CAP} results.
        </p>
      )}

      {activeTabs.length > 0 && (
        <section className="active-section" data-testid="active-section" aria-label="Active sessions">
          {/* Focusable, and it answers hover as well as focus: the legend below is the only place
              the four dots are ever explained, so it has to be reachable without a pointer. */}
          <div
            className="pinned-header active-header"
            data-testid="active-header"
            tabIndex={0}
            onPointerEnter={(e) => { setLegendAnchor(e.currentTarget.getBoundingClientRect()) }}
            onPointerLeave={() => { setLegendAnchor(null) }}
            onFocus={(e) => { setLegendAnchor(e.currentTarget.getBoundingClientRect()) }}
            onBlur={() => { setLegendAnchor(null) }}
          >
            <span className="pinned-label">Active</span>
            <span className="pinned-count">{activeTabs.length}</span>
          </div>
          {legendAnchor !== null && <ActivityLegend anchor={legendAnchor} />}
          {activeTabs.map((t) => (
            <button
              key={`${String(t.windowNumber)}:${t.key}`}
              className="session-row active-tab-row"
              data-testid="active-tab-row"
              onClick={() => onFocusTab(t.windowNumber, t.key)}
              title={`Window ${String(t.windowNumber)}`}
            >
              <span
                className="status-dot"
                data-testid="active-status-dot"
                data-status={t.status}
                role="img"
                aria-label={describeActivityStatus(t.status)}
              />
              <ActiveTabTitle sessionId={t.key} title={activeSessionsById.get(t.key)?.title ?? t.key} />
              <span className="active-window-number">W{t.windowNumber}</span>
            </button>
          ))}
        </section>
      )}

      {pinnedSessions.length > 0 && (
        <section className="pinned-section" data-testid="pinned-section">
          <button
            className="pinned-header"
            data-testid="pinned-toggle"
            aria-expanded={!pinnedCollapsed}
            onClick={() => onPinnedCollapsedChange(!pinnedCollapsed)}
          >
            <svg
              className="chevron"
              data-expanded={!pinnedCollapsed}
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="pinned-label">Pinned</span>
            <span className="pinned-count">{pinnedSessions.length}</span>
          </button>
          {!pinnedCollapsed && pinnedSessions.map((s) => (
            <div
              key={s.sessionId}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('application/x-apiary-pinned', s.sessionId)
              }}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('application/x-apiary-pinned')) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                const dragged = e.dataTransfer.getData('application/x-apiary-pinned')
                if (dragged === '' || dragged === s.sessionId) return
                e.preventDefault()
                onReorderPinned(dragged, s.sessionId)
              }}
            >
              <SessionRow
                session={s}
                selected={s.sessionId === selectedId}
                pinned
                onSelect={onSelect}
                onSplit={onSplitSession}
                onDelete={onDeleteSession}
                onTogglePin={onTogglePin}
                onEditNote={onEditNote}
                onMenu={(node, x, y) => setMenu({ kind: 'session', id: node.sessionId, x, y })}
                folderBranch={branchOfSession.get(s.sessionId) ?? null}
              />
            </div>
          ))}
        </section>
      )}

      {recentSessions.length > 0 && (
        <section className="recent-section" data-testid="recent-section">
          <button
            className="pinned-header"
            data-testid="recent-toggle"
            aria-expanded={!recentCollapsed}
            onClick={() => onRecentCollapsedChange(!recentCollapsed)}
          >
            <svg className="chevron" data-expanded={!recentCollapsed} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="pinned-label">Recent</span>
            <span className="pinned-count">{recentSessions.length}</span>
          </button>
          {!recentCollapsed && recentSessions.map((s) => (
            <div key={s.sessionId} className="recent-row-wrap">
              <SessionRow
                session={s}
                selected={s.sessionId === selectedId}
                pinned={false}
                onSelect={onSelect}
                onSplit={onSplitSession}
                onDelete={onDeleteSession}
                onTogglePin={onTogglePin}
                onEditNote={onEditNote}
                onMenu={(node, x, y) => setMenu({ kind: 'session', id: node.sessionId, x, y })}
                folderBranch={branchOfSession.get(s.sessionId) ?? null}
              />
              <button
                className="icon-button recent-dismiss"
                data-testid="recent-dismiss-button"
                title="Dismiss from Recent"
                aria-label="Dismiss from Recent"
                onClick={() => onDismissRecent(s)}
              >
                <CloseIcon />
              </button>
            </div>
          ))}
        </section>
      )}

      {pending.length > 0 && (
        <ul className="pending-list" data-testid="pending-list">
          {pending.map((p) => (
            <li key={p.ptyId}>
              <button
                className="session-row pending-row"
                data-testid="pending-session-item"
                onClick={() => onSelectPending(p.ptyId)}
                title={p.cwd}
              >
                <span className="live-dot" aria-label="running" />
                <span className="session-title">New session &middot; {p.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tree.length > 0 && searching && (
        <ul className="tree flat-results" data-testid="flat-results">
          {rankedResults.map(({ session, worktreeLabel }) => (
            <li key={session.sessionId}>
              <SessionRow
                session={session}
                selected={session.sessionId === selectedId}
                pinned={pinnedSet.has(session.sessionId)}
                onSelect={onSelect}
                onSplit={onSplitSession}
                onDelete={onDeleteSession}
                onTogglePin={onTogglePin}
                onEditNote={onEditNote}
                onMenu={(node, x, y) => setMenu({ kind: 'session', id: node.sessionId, x, y })}
                subtitle={worktreeLabel}
              />
            </li>
          ))}
        </ul>
      )}

      {tree.length > 0 && !searching && (
        <>
          {arranged.groups.map(({ group, folders }) => {
            const open = !groupsCollapsed.has(group.id)
            return (
              <section
                className="folder-group"
                data-testid="folder-group"
                key={group.id}
                data-drop-into={dropIntoGroup === group.id}
                // The drop target is the whole section, not just its heading: an empty group is
                // a heading and a line of placeholder text, and aiming at the heading alone meant
                // the one case that needs dragging most — filing the first folder into a new,
                // empty group — had almost nothing to aim at.
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes('application/x-apiary-folder')) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDropIntoGroup(group.id)
                }}
                onDragLeave={(e) => {
                  // Only when the pointer has left the section itself, not merely moved onto a
                  // row inside it, which fires dragleave for the child on the way past.
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDropIntoGroup((current) => (current === group.id ? null : current))
                  }
                }}
                onDrop={(e) => {
                  setDropIntoGroup(null)
                  const dragged = e.dataTransfer.getData('application/x-apiary-folder')
                  // Only a top-level folder can be filed into a group: a worktree belongs to its
                  // repository, and dropping one on the group's whitespace must not quietly move
                  // it out from under the repository it is part of.
                  if (dragged === '' || !topLevelPaths.has(dragged)) return
                  e.preventDefault()
                  assignFolder(dragged, group.id)
                }}
              >
                <div
                  className="folder-group-header-wrap"
                  data-group-id={group.id}
                  // Groups reorder by dragging their headings, the same gesture as everything else
                  // in this sidebar; the menu keeps Move up/down for keyboard and precision.
                  draggable={renamingGroup !== group.id}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('application/x-apiary-group', group.id)
                  }}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes('application/x-apiary-group')) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(e) => {
                    const dragged = e.dataTransfer.getData('application/x-apiary-group')
                    if (dragged === '' || dragged === group.id) return
                    e.preventDefault()
                    e.stopPropagation() // Not also a folder drop into this group.
                    patchGroups({ groups: moveGroupBefore(groupState.groups, dragged, group.id) })
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setMenu({ kind: 'group', id: group.id, x: e.clientX, y: e.clientY })
                  }}
                >
                  {renamingGroup === group.id ? (
                    <input
                      className="search folder-group-rename"
                      data-testid="folder-group-rename"
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(group.id)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(group.id)
                        if (e.key === 'Escape') setRenamingGroup(null)
                      }}
                    />
                  ) : (
                    <button
                      className="folder-group-header"
                      data-testid="folder-group-toggle"
                      aria-expanded={open}
                      onClick={() => patchGroups({
                        collapsed: open
                          ? [...groupState.collapsed, group.id]
                          : groupState.collapsed.filter((id) => id !== group.id),
                      })}
                    >
                      <svg className="chevron" data-expanded={open} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="folder-group-label">{group.name}</span>
                      <span className="pinned-count">{folders.length}</span>
                    </button>
                  )}
                </div>
                {open && folders.length > 0 && <SessionTree nodes={folders} {...treeProps} />}
                {open && folders.length === 0 && (
                  <p className="folder-group-empty muted" data-testid="folder-group-empty">
                    Drag a folder here.
                  </p>
                )}
              </section>
            )
          })}

          {arranged.ungrouped.length > 0 && <SessionTree nodes={arranged.ungrouped} {...treeProps} />}
        </>
      )}

      <ContextMenu
        items={menuItems()}
        position={menu === null ? null : { x: menu.x, y: menu.y }}
        onClose={() => setMenu(null)}
        testId="sidebar-menu"
      />
    </aside>
  )
}

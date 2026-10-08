import type { PtyId, SessionId } from '@shared/domain/ids'
import { type JSX, memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import type { ActiveTabPayload } from '@shared/api'
import { useTree } from '../../state/useTree'
import { rankSessions } from '@shared/sessionRank'
import { SEARCH_RESULT_CAP } from '@shared/treeFilter'
import { SessionTree } from './SessionTree'
import { ContextMenu } from '../../ui/ContextMenu'
import { groupFolders, orderFolders, type GroupState } from './model/groups'
import { selectRecent, type DismissedMap } from './model/recentSessions'
import { RefreshIcon, SidebarIcon } from '../../ui/icons'
import { SearchField } from './SearchField'
import { useNotifications } from '../../ui/notifications'
import { describeRefresh } from './model/refreshSummary'
import { useDialogActions } from '../dialogs/useDialogs'
import { createdWorktreeRoots, onlyWanted, withAllWorktrees } from './model/allWorktrees'
import { useAllWorktrees } from './model/useAllWorktrees'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { ActiveSection } from './ActiveSection'
import { PinnedSection } from './PinnedSection'
import { RecentSection } from './RecentSection'
import { PendingSection, type PendingSessionSummary } from './PendingSection'
import { SearchResults } from './SearchResults'
import { FolderGroup, type SharedTreeProps } from './FolderGroup'
import type { RowActions } from './rowActions'
import { countSessions, flattenTree } from '@shared/treeWalk'
import { folderBranches } from './treeUtils'
import { useRevealSession } from './useRevealSession'
import { useGroupActions } from './useGroupActions'
import { useSidebarMenu } from './useSidebarMenu'
import { useMainTreeNav } from './useMainTreeNav'
import { rescanSessions } from '../../state/sessions'

export type { PendingSessionSummary }

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
  /** A group's "+": pick a folder, start a session there. Resolves the folder, or null. */
  onNewSessionInPickedFolder?: () => Promise<string | null>
  /** Opens a session in a column of its own beside the current one. */
  onSplitSession: (session: SessionNode) => void
  /** Session ids the user has pinned, most recently pinned first. */
  pinned: string[]
  onTogglePin: (session: SessionNode) => void
  /** Starts a fork of a session: a new conversation seeded with this one's. */
  onForkSession: (sessionId: SessionId) => void
  /** Whether the pinned section is collapsed — persisted, like the folder collapse state. */
  pinnedCollapsed: boolean
  onPinnedCollapsedChange: (next: boolean) => void
  /** New-session ptys not yet resolved into a real SessionNode, excluding whichever one (if any)
   * is already the one shown in the main pane — so this lists only the ones a click would
   * actually switch to. */
  pending: PendingSessionSummary[]
  /** Switches the main pane to a pending session's terminal. */
  onSelectPending: (ptyId: PtyId) => void
  /** Ends a pending session's Claude — the row's stop button. */
  onStopPending?: (ptyId: PtyId) => void
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
  /** Top-level folders listing every worktree, sessions or not — see `UiState.showAllWorktrees`. */
  showAllWorktrees: string[]
  /** Worktrees made with "New worktree", listed under their folder even before a session — see
   *  `UiState.createdWorktrees`. */
  createdWorktrees: { folder: string; path: string }[]
  onToggleAllWorktrees: (path: string) => void
}

/**
 * Wrapped in its own ErrorBoundary (UI-24): the sidebar used to sit under only the root boundary,
 * so a render error anywhere in it — an unexpected title shape, a malformed group — replaced the
 * *entire window*, panes and terminals included, with the crash pane, although nothing about the
 * open sessions had actually broken. A fault in the tree now stays in the tree.
 *
 * The sections (Active, Pinned, Recent, Unnamed, search results, groups) are components of their
 * own and the group/menu/tree-navigation state is in hooks next to them (UI-19); this is the
 * search box, the data they all read, and the composition.
 */
function SidebarShell(props: Props): JSX.Element {
  return (
    <ErrorBoundary label="The sidebar">
      <SidebarInner {...props} />
    </ErrorBoundary>
  )
}

/** Memoized (UI-4): App's props to it are stable (tests/component/appPropStability.test.tsx), so a
 *  render of App that changes nothing the sidebar shows — a theme change, a notification — skips it. */
export const Sidebar = memo(SidebarShell)

function SidebarInner({
  hidden = false, onHide, hideTitle = 'Hide sidebar',
  selectedId, onSelect, collapsed, onCollapsedChange, onNewSession, onNewSessionInPickedFolder,
  onSplitSession, pinned, onTogglePin, onForkSession, pinnedCollapsed,
  onPinnedCollapsedChange,
  pending, onSelectPending, onStopPending, revealId, groupState, onGroupStateChange, onReorderPinned,
  recentSectionEnabled, recentSectionHours, dismissedRecent, recentCollapsed,
  onRecentCollapsedChange, onDismissRecent, activeTabs, onFocusTab,
  searchChatContent, searchSessionNotes, showAllWorktrees, createdWorktrees, onToggleAllWorktrees,
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
  // Dialogs are asked for directly, not through props App threads down (UI-1 step 5).
  const {
    deleteSession: onDeleteSession, moveSession: onSessionDropped, editNote: onEditNote, newWorktree: onNewWorktree,
  } = useDialogActions()
  const [refreshing, setRefreshing] = useState(false)
  // UI-11: bumped by the explicit Refresh button so a worktree added or removed on disk without
  // also changing which folders have sessions still reaches `useAllWorktrees` — see there.
  const [worktreeRefreshNonce, setWorktreeRefreshNonce] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useRevealSession(revealId, tree, collapsed, onCollapsedChange, listRef)

  const isEmpty = useMemo(() => !loading && tree.length === 0, [loading, tree])

  /**
   * Pinned rows, in the order they were pinned rather than the order the tree happens to hold
   * them. Resolved against the *filtered* tree, so a search narrows the pinned section too —
   * a pinned session that doesn't match what you typed would otherwise be the one row on screen
   * that ignores the search box.
   */
  const pinnedSet = useMemo(() => new Set(pinned), [pinned])
  const branchOfSession = useMemo(() => folderBranches(tree), [tree])
  const sessionsById = useMemo(() => flattenTree(tree), [tree])
  const pinnedSessions = useMemo(() => {
    return pinned.map((id) => sessionsById.get(id)).filter((s): s is SessionNode => s !== undefined)
  }, [sessionsById, pinned])

  /** Keys of every tab the Active section is already showing, so Recent never repeats one. */
  const activeIds = useMemo(() => new Set(activeTabs.map((t) => t.key)), [activeTabs])

  /**
   * Every session known anywhere, unfiltered — what the Active section resolves its titles
   * against (see ActiveSection), and what a dropped row is resolved to.
   */
  const activeSessionsById = useMemo(() => flattenTree(rawTree), [rawTree])

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
  // The folders to ask git about: those showing all their worktrees, and those a worktree was
  // made from (the top-level folder, when it was made from one of its worktrees). From the second
  // kind only the made ones are added.
  const createdRoots = useMemo(() => createdWorktreeRoots(createdWorktrees, rawTree), [createdWorktrees, rawTree])
  const asked = useMemo(
    () => [...new Set([...showAllWorktrees, ...createdRoots.keys()])],
    [showAllWorktrees, createdRoots],
  )
  const listed = useAllWorktrees(asked, rawTree, worktreeRefreshNonce, createdWorktrees.map((w) => w.path).join('\n'))
  const extraWorktrees = useMemo(
    () => onlyWanted(listed, showAllWorktrees, createdRoots),
    [listed, showAllWorktrees, createdRoots],
  )
  const arranged = useMemo(
    () => groupFolders(
      withAllWorktrees(tree, extraWorktrees), (n) => n.path,
      groupState.groups, groupState.assignments, groupState.folderOrder,
    ),
    [tree, extraWorktrees, groupState],
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

  const groups = useGroupActions(groupState, onGroupStateChange, tree, arranged)
  const { menu, setMenu, menuItems } = useSidebarMenu({
    tree, rawTree, pinned, groupState, showAllWorktrees, onToggleAllWorktrees, onForkSession, onReorderPinned, groups,
  })
  const mainTree = useMainTreeNav({
    arranged, collapsed, onCollapsedChange, groupState, patchGroups: groups.patchGroups, sessionsById,
    onSelect, onSplitSession, setMenu,
  })

  const onSessionMenu = useCallback((node: SessionNode, x: number, y: number) => {
    setMenu({ kind: 'session', id: node.sessionId, x, y })
  }, [setMenu])
  /** What every session row can do, in one object that only changes when one of them does — the
   *  rows take it as spread props, so they can skip a render this sidebar did not change for. */
  const rowActions: RowActions = useMemo(() => ({
    onSelect, onSplit: onSplitSession, onDelete: onDeleteSession, onTogglePin, onEditNote, onMenu: onSessionMenu,
  }), [onSelect, onSplitSession, onDeleteSession, onTogglePin, onEditNote, onSessionMenu])

  /** The tree props every level shares, so the grouped and ungrouped renders cannot drift apart. */
  const treeProps: SharedTreeProps = {
    collapsed,
    onToggle: toggle,
    selectedId,
    onSelect,
    onNewSession,
    onNewWorktree,
    onDeleteSession,
    onSplitSession,
    pinned: pinnedSet,
    onTogglePin,
    onEditNote,
    onReorderFolder: groups.reorderFolder,
    onFolderMenu: (path, x, y, nested) => setMenu({ kind: 'folder', id: path, x, y, nested }),
    onSessionMenu,
    // Resolved against the unfiltered tree — a session being dragged is on screen and therefore in
    // `tree` too, but there is no reason to make this depend on the search box being empty.
    onSessionDrop: (sessionId, folderPath) => {
      const session = activeSessionsById.get(sessionId)
      if (session !== undefined) onSessionDropped(session, folderPath)
    },
    orderFolders: (nodes: ProjectNode[]) => orderFolders(nodes, (n) => n.path, groupState.folderOrder),
    onCollapseBeneath: (path, beneath) => {
      const next = new Set(collapsed)
      for (const p of beneath) next.add(p)
      // Opened, if it was not: collapsing what is inside a closed folder would look like nothing
      // happened, and the list of worktrees is what the click is asking to see.
      next.delete(path)
      onCollapsedChange(next)
    },
    rovingTabIndex: mainTree.tabIndexFor,
  }

  return (
    // The frame is what glass themes paint their pane on (see styles.css): the sidebar itself
    // scrolls, and a pane drawn inside a scroller would scroll away with the list.
    <div className="sidebar-frame" hidden={hidden}>
    <aside className="sidebar" data-testid="sidebar" hidden={hidden}>
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
            void rescanSessions()
              .then(reloadNow)
              .then((next) => {
                setWorktreeRefreshNonce((n) => n + 1)
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

      {/* Everything below the search row scrolls; the row itself stays put, so search and Refresh
       *  are always one move away however far down the list you are. */}
      <div className="sidebar-list" data-testid="sidebar-list" ref={listRef}>

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
        <ActiveSection
          activeTabs={activeTabs}
          sessionsById={activeSessionsById}
          onFocusTab={onFocusTab}
          onEditNote={onEditNote}
        />
      )}

      {pinnedSessions.length > 0 && (
        <PinnedSection
          sessions={pinnedSessions}
          selectedId={selectedId}
          folderBranches={branchOfSession}
          collapsed={pinnedCollapsed}
          onCollapsedChange={onPinnedCollapsedChange}
          onReorderPinned={onReorderPinned}
          actions={rowActions}
        />
      )}

      {recentSessions.length > 0 && (
        <RecentSection
          sessions={recentSessions}
          selectedId={selectedId}
          folderBranches={branchOfSession}
          collapsed={recentCollapsed}
          onCollapsedChange={onRecentCollapsedChange}
          onDismiss={onDismissRecent}
          actions={rowActions}
        />
      )}

      {pending.length > 0 && (
        <PendingSection pending={pending} onSelect={onSelectPending} onStop={onStopPending} />
      )}

      {tree.length > 0 && searching && (
        <SearchResults results={rankedResults} selectedId={selectedId} pinned={pinnedSet} actions={rowActions} />
      )}

      {tree.length > 0 && !searching && (
        // UI-27 steps 1-2: the whole folder/session/group hierarchy is one WAI-ARIA tree —
        // see `useMainTreeNav`.
        <div
          role="tree"
          aria-label="Sessions"
          ref={mainTree.ref}
          onKeyDown={mainTree.onKeyDown}
          onFocus={mainTree.onFocus}
        >
          {arranged.groups.map(({ group, folders }) => (
            <FolderGroup
              key={group.id}
              group={group}
              folders={folders}
              open={!groupsCollapsed.has(group.id)}
              groupState={groupState}
              groups={groups}
              collapsed={collapsed}
              onCollapsedChange={onCollapsedChange}
              treeProps={treeProps}
              tabIndex={mainTree.tabIndexFor('group', group.id)}
              onMenu={(x, y) => setMenu({ kind: 'group', id: group.id, x, y })}
              onNewSessionInPickedFolder={onNewSessionInPickedFolder}
            />
          ))}

          {arranged.ungrouped.length > 0 && <SessionTree nodes={arranged.ungrouped} {...treeProps} />}
        </div>
      )}

      </div>
      <ContextMenu
        items={menuItems()}
        position={menu === null ? null : { x: menu.x, y: menu.y }}
        onClose={() => setMenu(null)}
        testId="sidebar-menu"
      />
    </aside>
    </div>
  )
}

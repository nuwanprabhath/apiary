import type { PtyId, SessionId } from '@shared/domain/ids'
import { type JSX, memo, useCallback, useDeferredValue, useMemo, useRef, useState } from 'react'
import type { SessionNode } from '@shared/types'
import type { ActiveTabPayload } from '@shared/api'
import { useTree } from '../../state/useTree'
import { ContextMenu } from '../../ui/ContextMenu'
import type { GroupState } from '../../state/groups'
import type { DismissedMap } from '../../state/recentSessions'
import { useDialogActions } from '../dialogs'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { ActiveSection } from './ActiveSection'
import { PinnedSection } from './PinnedSection'
import { RecentSection } from './RecentSection'
import { PendingSection, type PendingSessionSummary } from './PendingSection'
import { SearchResults } from './SearchResults'
import { FolderTree } from './FolderTree'
import { SidebarHeader } from './SidebarHeader'
import { SidebarNotices } from './SidebarNotices'
import { buildTreeProps } from './sidebarTreeProps'
import { useArrangedTree, usePinnedAndRecent, useRankedResults } from './useSidebarData'
import type { RowActions } from './rowActions'
import { flattenTree } from '@shared/treeWalk'
import { folderBranches } from './treeUtils'
import { useRevealSession } from './useRevealSession'
import { useGroupActions } from './useGroupActions'
import { useSidebarMenu } from './useSidebarMenu'
import { useMainTreeNav } from './useMainTreeNav'


interface Props {
  /** Folded away to the rail. Kept mounted meanwhile — see App. */
  hidden?: boolean
  onHide?: () => void
  /** The hide button's tooltip, which names the platform's shortcut. */
  hideTitle?: string
  selectedId: string | null
  onSelect: (session: SessionNode) => void
  /** Paths of folders currently collapsed. Anything not in this set is open, so a folder never
   * seen before opens by default. */
  collapsed: Set<string>
  onCollapsedChange: (next: Set<string>) => void
  onNewSession: (path: string) => void
  /** A group's "+": pick a folder, start a session there. Resolves the folder, or null. */
  onNewSessionInPickedFolder?: () => Promise<string | null>
  onSplitSession: (session: SessionNode) => void
  /** Session ids the user has pinned, most recently pinned first. */
  pinned: string[]
  onTogglePin: (session: SessionNode) => void
  onForkSession: (sessionId: SessionId) => void
  pinnedCollapsed: boolean
  onPinnedCollapsedChange: (next: boolean) => void
  /** New-session ptys not yet resolved into a real SessionNode, excluding whichever one (if any)
   * is already the one shown in the main pane — so this lists only the ones a click would
   * actually switch to. */
  pending: PendingSessionSummary[]
  onSelectPending: (ptyId: PtyId) => void
  onStopPending?: (ptyId: PtyId) => void
  /**
   * A session to scroll into view, set when its tab is activated (Settings > Sidebar). Changing
   * this is the whole signal: it is deliberately not the same as `selectedId`, so that merely
   * re-rendering with a selection does not yank the list around while you are scrolling it by hand.
   */
  revealId: string | null
  groupState: GroupState
  onGroupStateChange: (next: GroupState) => void
  onReorderPinned: (id: string, beforeId: string) => void
  recentSectionEnabled: boolean
  /** How far back, in hours, "recent" looks. */
  recentSectionHours: number
  /** Hide sessions not used for `hideOldSessionsDays` from the tree (not from search). */
  hideOldSessionsEnabled: boolean
  hideOldSessionsDays: number
  /** sessionId -> dismissedAtMs, shared like `pinned` — see state/recentSessions.ts. */
  dismissedRecent: DismissedMap
  recentCollapsed: boolean
  onRecentCollapsedChange: (next: boolean) => void
  /** Hides a session from Recent until it is used again. */
  onDismissRecent: (session: SessionNode) => void
  /** Every open tab across every window. */
  activeTabs: ActiveTabPayload[]
  onFocusTab: (windowNumber: number, key: string) => void
  searchChatContent: boolean
  searchSessionNotes: boolean
  /** Top-level folders listing every worktree, sessions or not — see `UiState.showAllWorktrees`. */
  showAllWorktrees: string[]
  /** Worktrees made with "New worktree", listed under their folder even before a session — see
   *  `UiState.createdWorktrees`. */
  createdWorktrees: { folder: string; path: string }[]
  onToggleAllWorktrees: (path: string) => void
}

/**
 * Wrapped in its own ErrorBoundary so a render fault in the tree does not replace the whole window,
 * panes and terminals included, with the crash pane.
 */
function SidebarShell(props: Props): JSX.Element {
  return (
    <ErrorBoundary label="The sidebar">
      <SidebarInner {...props} />
    </ErrorBoundary>
  )
}

/** Memoized: App's props to it are stable (tests/component/appPropStability.test.tsx), so an App
 *  render that changes nothing the sidebar shows skips it. */
export const Sidebar = memo(SidebarShell)

function SidebarInner({
  hidden = false, onHide, hideTitle = 'Hide sidebar',
  selectedId, onSelect, collapsed, onCollapsedChange, onNewSession, onNewSessionInPickedFolder,
  onSplitSession, pinned, onTogglePin, onForkSession, pinnedCollapsed,
  onPinnedCollapsedChange,
  pending, onSelectPending, onStopPending, revealId, groupState, onGroupStateChange, onReorderPinned,
  recentSectionEnabled, recentSectionHours, hideOldSessionsEnabled, hideOldSessionsDays, dismissedRecent, recentCollapsed,
  onRecentCollapsedChange, onDismissRecent, activeTabs, onFocusTab,
  searchChatContent, searchSessionNotes, showAllWorktrees, createdWorktrees, onToggleAllWorktrees,
}: Props): JSX.Element {
  /** The settled query — `SearchField` publishes it once typing pauses, never per keystroke. */
  const [query, setQuery] = useState('')
  /** The query the expensive work runs against: deferred so filtering and rendering several
   *  hundred rows is interruptible and the search box stays responsive. */
  const deferredQuery = useDeferredValue(query)
  const { tree, rawTree, settledQuery, matchedByContent, capped, loading, reload, reloadNow } = useTree(deferredQuery, {
    searchChatContent, searchSessionNotes,
  })
  const {
    deleteSession: onDeleteSession, moveSession: onSessionDropped, editNote: onEditNote, newWorktree: onNewWorktree,
  } = useDialogActions()
  // Bumped by the Refresh button so a worktree added or removed on disk, without changing which
  // folders have sessions, still reaches `useAllWorktrees`.
  const [worktreeRefreshNonce, setWorktreeRefreshNonce] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useRevealSession(revealId, tree, collapsed, onCollapsedChange, listRef)

  const isEmpty = useMemo(() => !loading && tree.length === 0, [loading, tree])
  const branchOfSession = useMemo(() => folderBranches(tree), [tree])
  const { pinnedSet, sessionsById, pinnedSessions, recentSessions } = usePinnedAndRecent({
    tree, pinned, activeTabs, dismissedRecent, recentSectionEnabled, recentSectionHours,
  })
  /** Every session known anywhere, unfiltered: Active resolves titles, and a dropped row, against it. */
  const activeSessionsById = useMemo(() => flattenTree(rawTree), [rawTree])
  // Keyed on the deferred query so what is on screen is always internally consistent: the flat
  // results list appears with the results, not a moment before them.
  const searching = deferredQuery.trim() !== ''
  const { withWorktrees, arranged } = useArrangedTree({
    tree, rawTree, groupState, showAllWorktrees, createdWorktrees, refreshNonce: worktreeRefreshNonce,
    prune: searching ? null : { days: hideOldSessionsEnabled ? hideOldSessionsDays : null, pinned, activeTabs },
  })
  const rankedResults = useRankedResults(tree, settledQuery, matchedByContent, pinnedSet)

  const groups = useGroupActions(groupState, onGroupStateChange, tree, arranged)
  const { menu, setMenu, menuItems } = useSidebarMenu({
    tree: withWorktrees, rawTree, pinned, groupState, showAllWorktrees, onToggleAllWorktrees, onForkSession, onReorderPinned, onTogglePin, groups,
  })
  const mainTree = useMainTreeNav({
    arranged, collapsed, onCollapsedChange, groupState, patchGroups: groups.patchGroups, sessionsById,
    onSelect, onSplitSession, setMenu,
  })

  const onSessionMenu = useCallback((node: SessionNode, x: number, y: number) => {
    setMenu({ kind: 'session', id: node.sessionId, x, y })
  }, [setMenu])
  /** One object that changes only when an action does, so memoized rows skip unrelated renders. */
  const rowActions: RowActions = useMemo(() => ({
    onSelect, onSplit: onSplitSession, onDelete: onDeleteSession, onTogglePin, onEditNote, onMenu: onSessionMenu,
  }), [onSelect, onSplitSession, onDeleteSession, onTogglePin, onEditNote, onSessionMenu])

  const treeProps = buildTreeProps({
    collapsed, onCollapsedChange, selectedId, onSelect, onNewSession, onNewWorktree, onDeleteSession,
    onSplitSession, pinnedSet, onTogglePin, onEditNote, onReorderFolder: groups.reorderFolder, setMenu,
    onSessionMenu, activeSessionsById, onSessionDropped, groupState, tabIndexFor: mainTree.tabIndexFor,
  })

  return (
    // The frame is what glass themes paint their pane on (see styles.css): the sidebar itself
    // scrolls, and a pane drawn inside a scroller would scroll away with the list.
    <div className="sidebar-frame" hidden={hidden}>
    <aside className="sidebar" data-testid="sidebar" hidden={hidden}>
      <SidebarHeader
        onHide={onHide} hideTitle={hideTitle} onQuery={setQuery} deferredQuery={deferredQuery}
        tree={tree} reload={reload} reloadNow={reloadNow}
        onRefreshed={() => setWorktreeRefreshNonce((n) => n + 1)}
      />

      <div className="sidebar-list" data-testid="sidebar-list" ref={listRef}>

      <SidebarNotices isEmpty={isEmpty} searchActive={searching} capped={capped} />

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
        <FolderTree
          mainTree={mainTree} arranged={arranged} groupState={groupState} groups={groups} collapsed={collapsed}
          onCollapsedChange={onCollapsedChange} treeProps={treeProps} setMenu={setMenu}
          onNewSessionInPickedFolder={onNewSessionInPickedFolder}
        />
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

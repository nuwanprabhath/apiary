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
  // Dialogs are asked for directly, not through props App threads down (UI-1 step 5).
  const {
    deleteSession: onDeleteSession, moveSession: onSessionDropped, editNote: onEditNote, newWorktree: onNewWorktree,
  } = useDialogActions()
  // UI-11: bumped by the explicit Refresh button so a worktree added or removed on disk without
  // also changing which folders have sessions still reaches `useAllWorktrees` — see there.
  const [worktreeRefreshNonce, setWorktreeRefreshNonce] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)

  useRevealSession(revealId, tree, collapsed, onCollapsedChange, listRef)

  const isEmpty = useMemo(() => !loading && tree.length === 0, [loading, tree])
  const branchOfSession = useMemo(() => folderBranches(tree), [tree])
  const { pinnedSet, sessionsById, pinnedSessions, recentSessions } = usePinnedAndRecent({
    tree, pinned, activeTabs, dismissedRecent, recentSectionEnabled, recentSectionHours,
  })
  /**
   * Every session known anywhere, unfiltered — what the Active section resolves its titles
   * against (see ActiveSection), and what a dropped row is resolved to.
   */
  const activeSessionsById = useMemo(() => flattenTree(rawTree), [rawTree])
  // Keyed on the deferred query so what is on screen is always internally consistent: the flat
  // results list appears with the results, not a moment before them.
  const searching = deferredQuery.trim() !== ''
  const { withWorktrees, arranged } = useArrangedTree({
    tree, rawTree, groupState, showAllWorktrees, createdWorktrees, refreshNonce: worktreeRefreshNonce,
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
  /** What every session row can do, in one object that only changes when one of them does — the
   *  rows take it as spread props, so they can skip a render this sidebar did not change for. */
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

      {/* Everything below the search row scrolls; the row itself stays put, so search and Refresh
       *  are always one move away however far down the list you are. */}
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

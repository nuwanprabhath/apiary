import { useMemo } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import type { ActiveTabPayload } from '@shared/api'
import { rankSessions } from '@shared/sessionRank'
import { SEARCH_RESULT_CAP } from '@shared/treeFilter'
import { flattenTree } from '@shared/treeWalk'
import { groupFolders, type GroupState } from '../../state/groups'
import { selectRecent, type DismissedMap } from '../../state/recentSessions'
import { createdWorktreeRoots, onlyWanted, withAllWorktrees } from './model/allWorktrees'
import { pruneSidebarTree } from './pruneSidebarTree'
import { useAllWorktrees } from './model/useAllWorktrees'

/**
 * The Pinned and Recent lists, resolved against the *filtered* tree so a search narrows them too.
 * Pinned rows keep the order they were pinned in, not the tree's. `activeTabs` keeps Recent from
 * repeating a session the Active section already shows.
 */
export function usePinnedAndRecent({ tree, pinned, activeTabs, dismissedRecent, recentSectionEnabled, recentSectionHours }: {
  tree: ProjectNode[]
  pinned: string[]
  activeTabs: ActiveTabPayload[]
  dismissedRecent: DismissedMap
  recentSectionEnabled: boolean
  recentSectionHours: number
}): { pinnedSet: Set<string>; sessionsById: Map<string, SessionNode>; pinnedSessions: SessionNode[]; recentSessions: SessionNode[] } {
  const pinnedSet = useMemo(() => new Set(pinned), [pinned])
  const sessionsById = useMemo(() => flattenTree(tree), [tree])
  const pinnedSessions = useMemo(() => {
    return pinned.map((id) => sessionsById.get(id)).filter((s): s is SessionNode => s !== undefined)
  }, [sessionsById, pinned])
  const activeIds = useMemo(() => new Set(activeTabs.map((t) => t.key)), [activeTabs])
  const recentSessions = useMemo(() => {
    if (!recentSectionEnabled) return []
    return selectRecent(
      Array.from(sessionsById.values()), pinnedSet, activeIds, dismissedRecent, Date.now(), recentSectionHours,
    )
  }, [sessionsById, pinnedSet, activeIds, dismissedRecent, recentSectionEnabled, recentSectionHours])
  return { pinnedSet, sessionsById, pinnedSessions, recentSessions }
}

/**
 * The top level, as the user arranged it: their groups first, then everything ungrouped, with the
 * worktrees the user asked to see added under their folders.
 *
 * Searching bypasses the arrangement: hiding matches inside collapsed groups would defeat typing.
 */
export function useArrangedTree({ tree, rawTree, groupState, showAllWorktrees, createdWorktrees, refreshNonce, prune }: {
  tree: ProjectNode[]
  /** Set while nothing is searched: drops folder-gone sessions, and old ones when `days` is set; pinned and open sessions are kept. */
  prune: { days: number | null; pinned: string[]; activeTabs: ActiveTabPayload[] } | null
  rawTree: ProjectNode[]
  groupState: GroupState
  showAllWorktrees: string[]
  createdWorktrees: { folder: string; path: string }[]
  refreshNonce: number
}): { withWorktrees: ProjectNode[]; arranged: ReturnType<typeof groupFolders<ProjectNode>> } {
  // The folders to ask git about: those showing all their worktrees, and those a worktree was
  // made from (the top-level folder, when it was made from one of its worktrees). From the second
  // kind only the made ones are added.
  const createdRoots = useMemo(() => createdWorktreeRoots(createdWorktrees, rawTree), [createdWorktrees, rawTree])
  const asked = useMemo(
    () => [...new Set([...showAllWorktrees, ...createdRoots.keys()])],
    [showAllWorktrees, createdRoots],
  )
  const listed = useAllWorktrees(asked, rawTree, refreshNonce, createdWorktrees.map((w) => w.path).join('\n'))
  const extraWorktrees = useMemo(
    () => onlyWanted(listed, showAllWorktrees, createdRoots),
    [listed, showAllWorktrees, createdRoots],
  )
  const hideDays = prune?.days ?? null
  const keepPinned = prune?.pinned
  const keepTabs = prune?.activeTabs
  const withWorktrees = useMemo(() => {
    const all = withAllWorktrees(tree, extraWorktrees)
    if (keepPinned === undefined || keepTabs === undefined) return all
    const keep = new Set([...keepPinned, ...keepTabs.map((t) => t.key)])
    return pruneSidebarTree(all, { days: hideDays, now: Date.now(), keep })
  }, [tree, extraWorktrees, hideDays, keepPinned, keepTabs])
  const arranged = useMemo(
    () => groupFolders(
      withWorktrees, (n) => n.path,
      groupState.groups, groupState.assignments, groupState.folderOrder,
    ),
    [withWorktrees, groupState],
  )
  return { withWorktrees, arranged }
}

/**
 * The flat, ranked results shown while searching: ranked over every match `tree` holds (uncapped;
 * see `filterTreeLocal`), with the cap applied here to the ranked list so the best matches
 * survive it. Memoized because `rankSessions` runs over the full match set.
 *
 * Keyed on `settledQuery`, never the live `query`: the live one misses the memo on every keystroke
 * while `tree` still holds the previous query's matches, re-ranking the widest match set
 * synchronously before the character paints, which stalled the window.
 */
export function useRankedResults(
  tree: ProjectNode[], settledQuery: string, matchedByContent: Set<string>, pinnedSet: Set<string>,
): ReturnType<typeof rankSessions> {
  return useMemo(
    () => rankSessions(tree, settledQuery, matchedByContent)
      // Pinned matches are already in the Pinned section above, as in the tree. Filtered before
      // the cap, so a pinned row's place goes to the next-best match.
      .filter(({ session }) => !pinnedSet.has(session.sessionId))
      .slice(0, SEARCH_RESULT_CAP),
    [tree, settledQuery, matchedByContent, pinnedSet],
  )
}

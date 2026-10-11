import { useMemo } from 'react'
import type { ProjectNode, SessionNode } from '@shared/types'
import type { ActiveTabPayload } from '@shared/api'
import { rankSessions } from '@shared/sessionRank'
import { SEARCH_RESULT_CAP } from '@shared/treeFilter'
import { flattenTree } from '@shared/treeWalk'
import { groupFolders, type GroupState } from '../../state/groups'
import { selectRecent, type DismissedMap } from '../../state/recentSessions'
import { createdWorktreeRoots, onlyWanted, withAllWorktrees } from './model/allWorktrees'
import { useAllWorktrees } from './model/useAllWorktrees'

/**
 * The Pinned and Recent lists, resolved against the *filtered* tree so a search narrows them too:
 * a pinned session that doesn't match what you typed would otherwise be the one row on screen
 * that ignores the search box. Pinned rows keep the order they were pinned in, not the tree's.
 * `activeTabs` keeps Recent from repeating a session the Active section already shows.
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
  /** Keys of every tab the Active section is already showing, so Recent never repeats one. */
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
 * Searching deliberately bypasses the arrangement — while a query is on, the tree is already a
 * filtered subset, and hiding matches inside collapsed groups would defeat the point of typing.
 */
export function useArrangedTree({ tree, rawTree, groupState, showAllWorktrees, createdWorktrees, refreshNonce }: {
  tree: ProjectNode[]
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
  const withWorktrees = useMemo(() => withAllWorktrees(tree, extraWorktrees), [tree, extraWorktrees])
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
 * The flat, ranked results shown while searching — ranked over every match `tree` holds (which
 * is uncapped; see `filterTreeLocal`), with the cap applied here, to the *ranked* list, so the
 * best matches survive it rather than whichever `SEARCH_RESULT_CAP` sessions a folder walk
 * happened to reach first. Memoized because `rankSessions` runs over the full match set and
 * re-ranking on every unrelated render (an Active-section poll, a git-status refresh) would
 * reintroduce exactly the per-render cost this feature exists to avoid.
 *
 * Keyed on `settledQuery`, never the live `query`. Keying on the live one made the memo miss on
 * every keystroke while `tree` still held the *previous* query's matches — so each character
 * typed re-ranked the widest match set there is (a one-character query matches nearly every
 * session), synchronously, before the character could be painted, and then ranked it again when
 * the debounce settled. That was the beach ball: typing the second letter of a search stalled
 * the whole window.
 */
export function useRankedResults(
  tree: ProjectNode[], settledQuery: string, matchedByContent: Set<string>, pinnedSet: Set<string>,
): ReturnType<typeof rankSessions> {
  return useMemo(
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
}

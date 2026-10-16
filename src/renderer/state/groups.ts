/**
 * Folder groups and ordering for the sidebar. Pure. Assignments and order are keyed by absolute
 * project path, the one identity a folder keeps across rescans; ids that no longer resolve are
 * ignored rather than cleaned up, so a folder that comes back finds its group again.
 */
import type { SessionGroup } from '@shared/libraryState'

export type { SessionGroup }

export interface GroupState {
  groups: SessionGroup[]
  /** Project path → group id. */
  assignments: Record<string, string>
  /** Ids of collapsed groups. */
  collapsed: string[]
  /** Project paths in the user's order. */
  folderOrder: string[]
}

export interface GroupedFolders<T> {
  /** Groups in display order, each with the folders assigned to it (also in display order). */
  groups: { group: SessionGroup; folders: T[] }[]
  /** Folders belonging to no group, shown under the groups. */
  ungrouped: T[]
}

/** A new group id. Random rather than sequential so two windows cannot mint the same one. */
export function newGroupId(): string {
  return `g-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

/** Anything absent from `order` sorts after everything in it, so a newly discovered folder lands at the bottom. */
export function orderFolders<T>(folders: T[], pathOf: (f: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((path, i) => [path, i]))
  return folders
    .map((folder, i) => ({ folder, i, rank: rank.get(pathOf(folder)) ?? Infinity }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((entry) => entry.folder)
}

export function groupFolders<T>(
  folders: T[],
  pathOf: (f: T) => string,
  groups: SessionGroup[],
  assignments: Record<string, string>,
  order: string[],
): GroupedFolders<T> {
  const ordered = orderFolders(folders, pathOf, order)
  const known = new Set(groups.map((g) => g.id))
  const groupIdFor = (folder: T): string | null => {
    const id = assignments[pathOf(folder)]
    // An assignment to a group that has since been deleted means ungrouped, not missing.
    return id !== undefined && known.has(id) ? id : null
  }

  return {
    groups: groups.map((group) => ({
      group,
      folders: ordered.filter((f) => groupIdFor(f) === group.id),
    })),
    ungrouped: ordered.filter((f) => groupIdFor(f) === null),
  }
}

export function moveFolder(order: string[], allPaths: string[], path: string, beforePath: string): string[] {
  // Complete list first: the stored order holds only folders dragged before, and a drop can land on one not in it.
  const full = orderFolders(allPaths, (p) => p, order)
  const rest = full.filter((p) => p !== path)
  const at = rest.indexOf(beforePath)
  if (at === -1) return full
  return [...rest.slice(0, at), path, ...rest.slice(at)]
}

export function moveBefore(ids: string[], id: string, beforeId: string): string[] {
  const rest = ids.filter((x) => x !== id)
  const at = rest.indexOf(beforeId)
  if (at === -1 || !ids.includes(id)) return ids
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

export function moveGroupBefore(groups: SessionGroup[], id: string, beforeId: string): SessionGroup[] {
  const order = moveBefore(groups.map((g) => g.id), id, beforeId)
  return order
    .map((gid) => groups.find((g) => g.id === gid))
    .filter((g): g is SessionGroup => g !== undefined)
}

export function moveGroup(groups: SessionGroup[], id: string, delta: -1 | 1): SessionGroup[] {
  const from = groups.findIndex((g) => g.id === id)
  if (from === -1) return groups
  const to = from + delta
  if (to < 0 || to >= groups.length) return groups
  const next = [...groups]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/** Removes a group. Its folders become ungrouped rather than disappearing with it. */
export function deleteGroup(
  groups: SessionGroup[],
  assignments: Record<string, string>,
  id: string,
): { groups: SessionGroup[]; assignments: Record<string, string> } {
  const next: Record<string, string> = {}
  for (const [path, groupId] of Object.entries(assignments)) {
    if (groupId !== id) next[path] = groupId
  }
  return { groups: groups.filter((g) => g.id !== id), assignments: next }
}

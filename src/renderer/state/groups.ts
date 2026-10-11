/**
 * Folder groups and folder ordering for the sidebar.
 *
 * The sidebar's top level is the user's arrangement, not the filesystem's: named groups in the
 * order they were put in, each holding folders assigned to it by path, followed by everything
 * ungrouped. The model is deliberately the same shape as the simple-worktrees VS Code extension's
 * — a flat, ordered list of groups plus a path→group map — because that is the interaction people
 * already know: make a group, drop folders in, rename it, move it up, delete it.
 *
 * Everything here is pure. Assignments and order are keyed by absolute project path, which is the
 * one identity a folder keeps across rescans; ids that no longer resolve are ignored rather than
 * cleaned up, so a folder that disappears and comes back finds its group again.
 */
/** One user-made heading in the sidebar. `id` is stable; `name` is what is shown and renamed. */
export interface SessionGroup {
  id: string
  name: string
}

/** The whole sidebar arrangement, passed around as one value rather than four parallel props. */
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

/**
 * Orders folders by the user's arrangement.
 *
 * Anything absent from `order` sorts after everything in it, keeping its existing relative
 * position. A folder discovered later therefore appears at the bottom rather than in the middle of
 * an arrangement someone made on purpose — and an arrangement made before that folder existed
 * still means what it meant.
 */
export function orderFolders<T>(folders: T[], pathOf: (f: T) => string, order: string[]): T[] {
  const rank = new Map(order.map((path, i) => [path, i]))
  return folders
    .map((folder, i) => ({ folder, i, rank: rank.get(pathOf(folder)) ?? Infinity }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((entry) => entry.folder)
}

/** Splits folders into their groups, dropping groups that would be empty of folders entirely. */
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

/** Moves `path` so it sits where `beforePath` was, for drag-to-reorder. */
export function moveFolder(order: string[], allPaths: string[], path: string, beforePath: string): string[] {
  // Start from a complete list: the stored order holds only what has been dragged before, and a
  // folder can be dropped onto one that has never been moved and so is not in it yet.
  const full = orderFolders(allPaths, (p) => p, order)
  const rest = full.filter((p) => p !== path)
  const at = rest.indexOf(beforePath)
  if (at === -1) return full
  return [...rest.slice(0, at), path, ...rest.slice(at)]
}

/** Reorders any list of ids by dropping one onto another — used for the pinned section too. */
export function moveBefore(ids: string[], id: string, beforeId: string): string[] {
  const rest = ids.filter((x) => x !== id)
  const at = rest.indexOf(beforeId)
  if (at === -1 || !ids.includes(id)) return ids
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

/** Moves a group to sit where the one it was dropped on was. */
export function moveGroupBefore(groups: SessionGroup[], id: string, beforeId: string): SessionGroup[] {
  const order = moveBefore(groups.map((g) => g.id), id, beforeId)
  return order
    .map((gid) => groups.find((g) => g.id === gid))
    .filter((g): g is SessionGroup => g !== undefined)
}

/** Moves a group one place up or down in the display order. */
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

import type { FolderWorktree, ProjectNode } from '@shared/types'

/**
 * Adds the worktrees `extras` lists to their folders, as empty folders beside the ones the tree
 * already has — "Show all worktrees" in a folder's menu. A worktree the tree already shows (it has
 * sessions) is left as it is, so this only ever adds rows. Kept in label order, as `buildTree`
 * orders the rest.
 */
export function withAllWorktrees(tree: ProjectNode[], extras: ReadonlyMap<string, FolderWorktree[]>): ProjectNode[] {
  if (extras.size === 0) return tree
  return tree.map((node) => {
    const listed = extras.get(node.path)
    if (listed === undefined) return node
    const known = new Set(node.children.map((c) => c.path))
    const added = listed
      .filter((w) => !known.has(w.path))
      .map((w): ProjectNode => ({
        kind: 'project',
        path: w.path,
        label: w.path.split(/[\\/]/).filter(Boolean).pop() ?? w.path,
        branch: w.branch,
        isWorktree: true,
        children: [],
        sessions: [],
      }))
    if (added.length === 0) return node
    return {
      ...node,
      children: [...node.children, ...added].sort((a, b) => a.label.localeCompare(b.label)),
    }
  })
}

/**
 * The top-level folder each made worktree belongs under, with the worktree paths made there: the
 * folder it was made from, or the folder whose worktree that was. A folder no longer in the tree
 * adds nothing.
 */
export function createdWorktreeRoots(
  created: readonly { folder: string; path: string }[], tree: readonly ProjectNode[],
): Map<string, Set<string>> {
  const roots = new Map<string, Set<string>>()
  for (const w of created) {
    const root = tree.find((n) => n.path === w.folder || n.children.some((c) => c.path === w.folder))
    if (root === undefined) continue
    const paths = roots.get(root.path) ?? new Set<string>()
    paths.add(w.path)
    roots.set(root.path, paths)
  }
  return roots
}

/** What git listed, cut down to what is wanted: every worktree of a folder showing all of them,
 *  only the made ones of any other. */
export function onlyWanted(
  listed: ReadonlyMap<string, FolderWorktree[]>, showAll: readonly string[], created: ReadonlyMap<string, Set<string>>,
): ReadonlyMap<string, FolderWorktree[]> {
  const out = new Map<string, FolderWorktree[]>()
  for (const [folder, worktrees] of listed) {
    if (showAll.includes(folder)) { out.set(folder, worktrees); continue }
    const made = created.get(folder)
    const kept = made === undefined ? [] : worktrees.filter((w) => made.has(w.path))
    if (kept.length > 0) out.set(folder, kept)
  }
  return out
}

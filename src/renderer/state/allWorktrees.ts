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

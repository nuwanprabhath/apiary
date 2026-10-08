import type { ProjectNode } from '@shared/types'
import { treeStore } from './treeStore'

/** The unfiltered tree, fetched once and refreshed only on the watcher's `treeChanged` signal or
 *  an explicit reload — never on a keystroke. Filtering against it happens elsewhere. Every caller
 *  reads the one `treeStore`; there is no copy of the tree per hook. */
export function useSessionTreeCache(): {
  rawTree: ProjectNode[]
  loading: boolean
  reload: () => void
  reloadNow: () => Promise<ProjectNode[]>
} {
  const rawTree = treeStore.useTree()
  const loaded = treeStore.useLoaded()
  return { rawTree, loading: !loaded, reload: treeStore.reload, reloadNow: treeStore.reloadNow }
}

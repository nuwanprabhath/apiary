/** One stop on the path above the list: a button that jumps to `index`, or the "…" standing for those folded away. */
export interface CrumbItem {
  label: string
  /** The crumb index to jump to; null for the "…" and for the folder being shown. */
  index: number | null
  /** The full path, on the "…" (the folded names) and on a name that may be cut short. */
  title?: string
}

/** Paths longer than this fold their middle: home, "…", then the last two folders. */
const MAX_CRUMBS_SHOWN = 4

/**
 * The crumbs as they are drawn. A deep path would otherwise run out of the dialog, so everything
 * between home and the last two folders becomes one "…" whose title is the whole path.
 */
export function collapseCrumbs(crumbs: string[]): CrumbItem[] {
  const last = crumbs.length - 1
  const item = (index: number): CrumbItem => ({ label: crumbs[index] ?? '', index: index === last ? null : index })
  if (crumbs.length <= MAX_CRUMBS_SHOWN) return crumbs.map((_, i) => item(i))
  return [item(0), { label: '…', index: null, title: crumbs.join(' › ') }, item(last - 1), item(last)]
}

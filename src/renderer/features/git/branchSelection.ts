import type { GitRefEntry, GitRefs } from '@shared/types'

/** What Enter would check out right now, if the switcher's search box holds a real answer. */
export interface RefMatch {
  entry: GitRefEntry
  kind: 'local' | 'remote'
}

/**
 * The ref an exact, case-sensitive match on the typed query names — or null.
 *
 * Only an exact match counts: a query that merely narrows the filtered list (a prefix or a
 * substring) is not a choice, so Enter must do nothing rather than guess which of several rows
 * was meant. Case-sensitive because git branch names are. Local wins over a remote branch of the
 * same name, since checking out a name that already exists locally must never quietly create a
 * tracking branch instead.
 */
export function exactRefMatch(refs: Pick<GitRefs, 'local' | 'remote'>, query: string): RefMatch | null {
  if (query === '') return null
  const local = refs.local.find((r) => r.name === query)
  if (local !== undefined) return { entry: local, kind: 'local' }
  const remote = refs.remote.find((r) => r.name === query)
  if (remote !== undefined) return { entry: remote, kind: 'remote' }
  return null
}

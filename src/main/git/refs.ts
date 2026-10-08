/**
 * The one place that asks git for ref names and turns them into names to show.
 *
 * Why not `%(refname:short)`, `--abbrev-ref` or `symbolic-ref --short`: the short form is
 * git's presentation of a ref, and it changes. Since git 2.48 `origin/HEAD` shortens to a bare
 * `origin` (so the "drop `/HEAD`" filter missed it and the branch list offered a remote called
 * `origin`), and an ambiguous ref prints as `heads/x` or `remotes/origin/x`. The full refname
 * (`refs/heads/x`) never varies, so every caller asks for that and removes the namespace itself.
 * The `no-short-refnames` lint rule keeps the short forms out of everything but this file.
 */

/** Which refs `listRefs` reads; the value is the namespace removed from each full refname. */
const NAMESPACE = {
  heads: 'refs/heads/',
  remotes: 'refs/remotes/',
  tags: 'refs/tags/',
} as const

export type RefNamespace = keyof typeof NAMESPACE

/** `refs/heads/feature/x` becomes `feature/x`; null when it is not a branch (a tag, `refs/remotes/…`). */
export function branchFromRef(fullRef: string): string | null {
  return fullRef.startsWith(NAMESPACE.heads) ? fullRef.slice(NAMESPACE.heads.length) : null
}

export interface RefRow {
  /** The refname without its namespace: `main`, `origin/feature/x`, `v1.0.0`. */
  name: string
  /** One value per extra atom asked for, in order. */
  fields: string[]
}

/** The `for-each-ref` arguments for `namespace`: `fields` are format atoms such as `%(authorname)`. */
export function listRefsArgs(namespace: RefNamespace, fields: readonly string[], sort?: string): string[] {
  const format = ['%(refname)', '%(symref)', ...fields].join('%09')
  return ['for-each-ref', ...(sort === undefined ? [] : [`--sort=${sort}`]), `--format=${format}`, NAMESPACE[namespace]]
}

/**
 * Parses what `listRefsArgs` printed. Symbolic refs (`refs/remotes/origin/HEAD` points at another
 * remote branch) are aliases, not branches or tags to pick, so they are dropped here by what git
 * says they are (`%(symref)`), not by how their name ends.
 */
export function parseRefRows(namespace: RefNamespace, raw: string): RefRow[] {
  const prefix = NAMESPACE[namespace]
  const rows: RefRow[] = []
  for (const line of raw.split('\n')) {
    if (line === '') continue
    const [refname = '', symref = '', ...fields] = line.split('\t')
    if (symref !== '' || !refname.startsWith(prefix)) continue
    rows.push({ name: refname.slice(prefix.length), fields })
  }
  return rows
}

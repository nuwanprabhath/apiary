/**
 * What a forked session is called.
 *
 * A fork is a real session of its own the moment Claude writes its JSONL, and Claude's own title
 * for it is generated from the conversation — which, for a fork, is the *same* conversation the
 * original was titled from. Two rows with the same title and no way to tell which is which is the
 * thing this prevents: the prefix is applied by Apiary as a rename the instant the session
 * resolves, so the fork is identifiable from the moment it exists.
 *
 * Forking a fork nests the prefix rather than collapsing it. That is honest — the second fork
 * really did come from the first, not from the original — and the alternative (one prefix however
 * deep you go) makes a chain of forks indistinguishable from a handful of siblings.
 */
export function forkLabel(title: string): string {
  return `fork: ${title}`
}

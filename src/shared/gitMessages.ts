/**
 * What the pull and push buttons say when they finish. Git's own output is never shown, so the
 * count is the only way to tell "ten commits arrived" from "nothing happened".
 */

function commits(n: number): string {
  return `${String(n)} commit${n === 1 ? '' : 's'}`
}

export function pullMessage(count: number): string {
  return count === 0 ? 'Already up to date.' : `Pulled ${commits(count)} from upstream.`
}

export function pushMessage(outcome: { commits: number; published: boolean }): string {
  if (outcome.published) {
    return outcome.commits === 0
      ? 'Published the branch.'
      : `Published the branch with ${commits(outcome.commits)}.`
  }
  return outcome.commits === 0 ? 'Nothing to push — upstream already has every commit.'
    : `Pushed ${commits(outcome.commits)} to upstream.`
}

/** The worktree dialog's pull: which branch, where, and how much moved. */
export function worktreePullMessage(branch: string, where: string, count: number): string {
  return count === 0
    ? `${branch} in ${where} is already up to date.`
    : `Pulled ${commits(count)} into ${branch} in ${where}.`
}

/** The branch list's pull button: which branch, and how much moved. */
export function updateBranchMessage(branch: string, count: number): string {
  return count === 0 ? `${branch} is already up to date.` : `Pulled ${commits(count)} into ${branch}.`
}

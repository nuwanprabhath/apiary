import type { JSX } from 'react'
import { focusAskedFor } from '../../ui/focusUnlessTyping'

interface Props {
  branchName: string
  /** The base the new branch starts from; undefined is the current HEAD. */
  from: string | undefined
  busy: boolean
  /** Why the typed branch name is unusable, or null. */
  branchProblem: string | null
  onBranchName: (name: string) => void
  onBack: () => void
  onCreate: () => void
}

/** The last step of the new-worktree dialog: the name of the branch being created. */
export function WorktreeNewBranchStep(
  { branchName, from, busy, branchProblem, onBranchName, onBack, onCreate }: Props,
): JSX.Element {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (branchProblem === null && !busy) onCreate()
      }}
    >
      <input
        className="search"
        data-testid="new-worktree-branch-name"
        placeholder="Name for the new branch"
        value={branchName}
        ref={focusAskedFor}
        onChange={(e) => { onBranchName(e.target.value) }}
      />
      <p className="new-worktree-hint">
        {branchProblem ?? `From ${from ?? 'the current HEAD'}`}
      </p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onBack}>Back</button>
        <button
          type="submit"
          className="btn primary"
          data-testid="new-worktree-create"
          disabled={busy || branchProblem !== null}
        >
          Create worktree
        </button>
      </div>
    </form>
  )
}

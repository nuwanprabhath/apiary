import type { JSX } from 'react'
import type { WorktreeCreateOptions } from '@shared/domain/git'
import { focusAskedFor } from '../../ui/focusUnlessTyping'

interface Props {
  name: string
  options: WorktreeCreateOptions | null
  /** Why the typed folder name is unusable, or null. */
  nameProblem: string | null
  onName: (name: string) => void
  onNext: () => void
  onClose: () => void
}

/** The first step of the new-worktree dialog: the folder name. */
export function WorktreeNameStep({ name, options, nameProblem, onName, onNext, onClose }: Props): JSX.Element {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (nameProblem === null && options !== null) onNext() }}
    >
      <input
        className="search"
        data-testid="new-worktree-name"
        placeholder="Folder name, e.g. species-list"
        value={name}
        ref={focusAskedFor}
        onChange={(e) => { onName(e.target.value) }}
      />
      <p className="new-worktree-hint" data-testid="new-worktree-location">
        {options === null
          ? 'Reading the repository…'
          : name.trim() !== '' && nameProblem !== null
            ? nameProblem
            : `Created in ${options.parentDir}/${name.trim()}`}
      </p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button
          type="submit"
          className="btn primary"
          data-testid="new-worktree-next"
          disabled={options === null || nameProblem !== null}
        >
          Next
        </button>
      </div>
    </form>
  )
}

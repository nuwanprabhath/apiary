import type { JSX } from 'react'
import { Modal } from '../../ui/Modal'

interface Props {
  nameDraft: string
  busy: boolean
  errorMessage: string | null
  onNameDraft: (name: string) => void
  onCreate: () => void
  onBack: () => void
  onClose: () => void
}

/** The branch switcher's "name the new branch" step. */
export function BranchNameStep(
  { nameDraft, busy, errorMessage, onNameDraft, onCreate, onBack, onClose }: Props,
): JSX.Element {
  return (
    <Modal
      testId="branch-switcher"
      titleId="branch-switcher-title"
      onClose={onClose}
      className="branch-switcher"
      initialFocusSelector='[data-testid="branch-switcher-name-input"]'
      closeOnBackdropClick
    >
      <h2 id="branch-switcher-title" className="visually-hidden">New branch name</h2>
      {errorMessage !== null && (
        <p className="error-banner" data-testid="branch-switcher-error">{errorMessage}</p>
      )}
      <input
        className="search"
        data-testid="branch-switcher-name-input"
        placeholder="Branch name"
        value={nameDraft}
        onChange={(e) => { onNameDraft(e.target.value) }}
        onKeyDown={(e) => { if (e.key === 'Enter') onCreate() }}
      />
      <div className="modal-actions">
        <button className="btn" data-testid="branch-switcher-cancel" onClick={onBack}>Back</button>
        <button className="btn primary" data-testid="branch-switcher-confirm" disabled={busy || nameDraft.trim() === ''} onClick={onCreate}>
          Create branch
        </button>
      </div>
    </Modal>
  )
}

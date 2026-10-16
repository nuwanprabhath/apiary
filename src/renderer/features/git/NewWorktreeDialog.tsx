import { type JSX, useEffect, useMemo, useState } from 'react'
import {
  worktreeNameProblem, type WorktreeBranchChoice, type WorktreeCreateOptions,
} from '@shared/domain/git'
import type { NewSessionInfo } from '@shared/types'
import { describeError } from '../../ui/errors'
import { Modal } from '../../ui/Modal'
import { WorktreeBranchStep } from './WorktreeBranchStep'
import { WorktreeNameStep } from './WorktreeNameStep'
import { WorktreeNewBranchStep } from './WorktreeNewBranchStep'
import { createWorktree, worktreeCreateOptions } from '../../state/git'

interface Props {
  /** The sidebar folder the "+" belonged to. Main resolves the repository from it. */
  folderPath: string
  folderLabel: string
  onClose: () => void
  /** The worktree exists and a Claude session is starting in it. */
  onCreated: (info: NewSessionInfo) => void
}

/**
 * The order follows the simple-worktrees VS Code extension's: name the folder, then pick the
 * branch to check out in it; "Create new branch…" asks for a base (current HEAD, or any branch)
 * and then the new branch's name, which defaults to the folder's.
 */
type Step =
  | { kind: 'name' }
  | { kind: 'branch' }
  | { kind: 'base' }
  | { kind: 'new-branch'; from?: string }

export function NewWorktreeDialog({ folderPath, folderLabel, onClose, onCreated }: Props): JSX.Element {
  const [options, setOptions] = useState<WorktreeCreateOptions | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'name' })
  const [name, setName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    worktreeCreateOptions(folderPath)
      .then((o) => { if (!cancelled) setOptions(o) })
      .catch((e: unknown) => { if (!cancelled) setError(describeError(e).message) })
    return () => { cancelled = true }
  }, [folderPath])

  const nameProblem = worktreeNameProblem(name, options?.existingNames ?? [])
  const branchProblem = branchName.trim() === ''
    ? 'A branch name is required.'
    : options?.local.includes(branchName.trim()) === true ? 'A local branch with this name already exists.' : null

  const q = query.trim().toLowerCase()
  const local = useMemo(() => (options?.local ?? []).filter((b) => b.toLowerCase().includes(q)), [options, q])
  const remote = useMemo(() => (options?.remote ?? []).filter((b) => b.toLowerCase().includes(q)), [options, q])

  const create = async (branch: WorktreeBranchChoice): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      onCreated(await createWorktree(folderPath, { name: name.trim(), branch }))
    } catch (e) {
      setError(describeError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const go = (next: Step): void => { setError(null); setQuery(''); setStep(next) }

  const heading = step.kind === 'name'
    ? `New worktree for ${folderLabel}`
    : step.kind === 'branch' ? `New worktree — ${name.trim()}`
      : step.kind === 'base' ? 'Create the new branch from…' : 'New branch name'

  return (
    <Modal
      testId="new-worktree-dialog"
      titleId="new-worktree-title"
      onClose={onClose}
      wide
      className="branch-switcher"
      initialFocusSelector="input"
      closeOnBackdropClick
    >
      <h2 id="new-worktree-title" className="new-worktree-title">{heading}</h2>
      {error !== null && <p className="error-banner" data-testid="new-worktree-error">{error}</p>}

      {step.kind === 'name' && (
        <WorktreeNameStep
          name={name}
          options={options}
          nameProblem={nameProblem}
          onName={(n) => { setName(n); setError(null) }}
          onNext={() => { go({ kind: 'branch' }) }}
          onClose={onClose}
        />
      )}

      {(step.kind === 'branch' || step.kind === 'base') && (
        <WorktreeBranchStep
          mode={step.kind}
          options={options}
          query={query}
          local={local}
          remote={remote}
          busy={busy}
          onQuery={setQuery}
          onPick={(kind, b) => {
            if (step.kind === 'branch') void create(kind === 'local' ? { kind: 'local', branch: b } : { kind: 'remote', ref: b })
            else { setBranchName(name.trim()); go({ kind: 'new-branch', from: b }) }
          }}
          onNewBranch={() => { go({ kind: 'base' }) }}
          onCurrentHead={() => { setBranchName(name.trim()); go({ kind: 'new-branch' }) }}
          onBack={() => { go(step.kind === 'branch' ? { kind: 'name' } : { kind: 'branch' }) }}
        />
      )}

      {step.kind === 'new-branch' && (
        <WorktreeNewBranchStep
          branchName={branchName}
          from={step.from}
          busy={busy}
          branchProblem={branchProblem}
          onBranchName={(n) => { setBranchName(n); setError(null) }}
          onBack={() => { go({ kind: 'base' }) }}
          onCreate={() => {
            void create({ kind: 'new', branch: branchName.trim(), ...(step.from !== undefined ? { from: step.from } : {}) })
          }}
        />
      )}
    </Modal>
  )
}

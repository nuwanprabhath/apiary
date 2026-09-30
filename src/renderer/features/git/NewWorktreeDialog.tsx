import { type JSX, useEffect, useMemo, useRef, useState } from 'react'
import {
  worktreeNameProblem, type WorktreeBranchChoice, type WorktreeCreateOptions,
} from '@shared/domain/git'
import type { NewSessionInfo } from '@shared/types'
import { describeError } from '../../ui/errors'
import { Modal } from '../../ui/Modal'

interface Props {
  /** The sidebar folder the "+" belonged to. Main resolves the repository from it. */
  folderPath: string
  folderLabel: string
  onClose: () => void
  /** The worktree exists and a Claude session is starting in it. */
  onCreated: (info: NewSessionInfo) => void
}

/**
 * Where the dialog is. The order is the simple-worktrees VS Code extension's, deliberately — the
 * same person uses both: name the folder, then pick the branch to check out in it; "Create new
 * branch…" asks for a base (current HEAD, or any branch) and then the new branch's name, which
 * defaults to the folder's.
 */
type Step =
  | { kind: 'name' }
  | { kind: 'branch' }
  | { kind: 'base' }
  | { kind: 'new-branch'; from?: string }

const ROW_SELECTOR = '.branch-switcher-action, .branch-switcher-row'

/** ArrowUp/Down/Home/End between the rows of a list step, as in the branch switcher. */
function onRowsKeyDown(e: React.KeyboardEvent, container: HTMLElement | null): void {
  if (container === null || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
  const rows = [...container.querySelectorAll<HTMLElement>(ROW_SELECTOR)].filter((r) => !r.hasAttribute('disabled'))
  if (rows.length === 0) return
  const current = rows.indexOf(document.activeElement as HTMLElement)
  let next: number
  if (e.key === 'Home') next = 0
  else if (e.key === 'End') next = rows.length - 1
  else if (e.key === 'ArrowDown') next = current === -1 ? 0 : (current + 1) % rows.length
  else next = current <= 0 ? rows.length - 1 : current - 1
  e.preventDefault()
  rows[next]?.focus()
}

export function NewWorktreeDialog({ folderPath, folderLabel, onClose, onCreated }: Props): JSX.Element {
  const [options, setOptions] = useState<WorktreeCreateOptions | null>(null)
  const [step, setStep] = useState<Step>({ kind: 'name' })
  const [name, setName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const listRef = useRef<HTMLUListElement | null>(null)

  useEffect(() => {
    let cancelled = false
    window.apiary.worktreeCreateOptions(folderPath)
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
      onCreated(await window.apiary.worktreeCreate(folderPath, { name: name.trim(), branch }))
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

  const listStep = step.kind === 'branch' || step.kind === 'base'

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
        <form
          onSubmit={(e) => { e.preventDefault(); if (nameProblem === null && options !== null) go({ kind: 'branch' }) }}
        >
          <input
            className="search"
            data-testid="new-worktree-name"
            placeholder="Folder name, e.g. species-list"
            value={name}
            autoFocus
            onChange={(e) => { setName(e.target.value); setError(null) }}
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
      )}

      {listStep && (
        <>
          <input
            key={step.kind}
            className="search"
            data-testid="new-worktree-branch-search"
            placeholder={step.kind === 'branch' ? 'Select a branch to check out, or create a new one' : 'Filter branches'}
            value={query}
            autoFocus
            onChange={(e) => { setQuery(e.target.value) }}
            onKeyDown={(e) => { onRowsKeyDown(e, listRef.current) }}
          />
          <ul ref={listRef} className="branch-switcher-list" onKeyDown={(e) => { onRowsKeyDown(e, listRef.current) }}>
            {step.kind === 'branch' && (
              <li>
                <button
                  className="branch-switcher-action"
                  data-testid="new-worktree-new-branch"
                  disabled={busy}
                  onClick={() => go({ kind: 'base' })}
                >
                  + Create new branch…
                </button>
              </li>
            )}
            {step.kind === 'base' && (
              <li>
                <button
                  className="branch-switcher-action"
                  data-testid="new-worktree-base-head"
                  onClick={() => { setBranchName(name.trim()); go({ kind: 'new-branch' }) }}
                >
                  Current HEAD
                </button>
              </li>
            )}
            {local.length > 0 && <li className="branch-switcher-section-label">local branches</li>}
            {local.map((b) => {
              const taken = step.kind === 'branch' && options?.checkedOut.includes(b) === true
              return (
                <li key={`l:${b}`} className="branch-switcher-item">
                  <button
                    className="branch-switcher-row"
                    data-testid="new-worktree-local-row"
                    disabled={busy || taken}
                    title={taken ? 'Already checked out in another worktree — git allows a branch in one worktree at a time.' : undefined}
                    onClick={() => {
                      if (step.kind === 'branch') void create({ kind: 'local', branch: b })
                      else { setBranchName(name.trim()); go({ kind: 'new-branch', from: b }) }
                    }}
                  >
                    <span className="branch-switcher-row-name">{b}</span>
                    {taken && <span className="branch-switcher-row-meta">already checked out</span>}
                  </button>
                </li>
              )
            })}
            {remote.length > 0 && <li className="branch-switcher-section-label">remote branches</li>}
            {remote.map((b) => (
              <li key={`r:${b}`} className="branch-switcher-item">
                <button
                  className="branch-switcher-row"
                  data-testid="new-worktree-remote-row"
                  disabled={busy}
                  onClick={() => {
                    if (step.kind === 'branch') void create({ kind: 'remote', ref: b })
                    else { setBranchName(name.trim()); go({ kind: 'new-branch', from: b }) }
                  }}
                >
                  <span className="branch-switcher-row-name">{b}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button
              type="button"
              className="btn"
              data-testid="new-worktree-back"
              onClick={() => go(step.kind === 'branch' ? { kind: 'name' } : { kind: 'branch' })}
            >
              Back
            </button>
          </div>
        </>
      )}

      {step.kind === 'new-branch' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (branchProblem === null && !busy) {
              void create({ kind: 'new', branch: branchName.trim(), ...(step.from !== undefined ? { from: step.from } : {}) })
            }
          }}
        >
          <input
            className="search"
            data-testid="new-worktree-branch-name"
            placeholder="Name for the new branch"
            value={branchName}
            autoFocus
            onChange={(e) => { setBranchName(e.target.value); setError(null) }}
          />
          <p className="new-worktree-hint">
            {branchProblem ?? `From ${step.from ?? 'the current HEAD'}`}
          </p>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => go({ kind: 'base' })}>Back</button>
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
      )}
    </Modal>
  )
}

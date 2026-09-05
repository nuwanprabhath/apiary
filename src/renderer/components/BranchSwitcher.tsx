import { useEffect, useMemo, useState } from 'react'
import type { GitRefEntry, GitRefs } from '@shared/types'

interface Props {
  shellKey: string
  isPtyId: boolean
  onClose: () => void
  onCheckedOut: () => void
  onError: (message: string) => void
}

type Step =
  | { kind: 'list' }
  | { kind: 'name'; from?: string }
  | { kind: 'pick-base' }
  | { kind: 'pick-detached' }

function matches(entry: GitRefEntry, query: string): boolean {
  return query === '' || entry.name.toLowerCase().includes(query)
}

export function BranchSwitcher({ shellKey, isPtyId, onClose, onCheckedOut, onError }: Props): JSX.Element {
  const [refs, setRefs] = useState<GitRefs | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step>({ kind: 'list' })
  const [nameDraft, setNameDraft] = useState('')
  // Shown inside this modal itself — the modal's own backdrop (position:fixed, full-viewport,
  // 55% black wash) fully covers App.tsx's error-banner behind it, so a failed
  // checkout/create surfaces here instead of routing only through the parent's onError, which
  // would otherwise render invisibly behind the still-open modal.
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const reportError = (message: string): void => {
    setErrorMessage(message)
    onError(message)
  }

  useEffect(() => {
    void window.apiary.gitListRefs(shellKey, isPtyId).then(setRefs).catch((e: Error) => onError(e.message))
    // Runs once on open — intentionally not re-fetching on every keystroke of `query`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (refs === null) return { local: [], remote: [], tags: [] }
    return {
      local: refs.local.filter((r) => matches(r, q)),
      remote: refs.remote.filter((r) => matches(r, q)),
      tags: refs.tags.filter((r) => matches(r, q)),
    }
  }, [refs, q])

  const checkout = async (name: string): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      await window.apiary.gitCheckoutBranch(shellKey, isPtyId, name)
      onCheckedOut()
      onClose()
    } catch (e) {
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkoutRemote = async (remoteRef: string): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      const localName = remoteRef.slice(remoteRef.indexOf('/') + 1)
      await window.apiary.gitCheckoutRemote(shellKey, isPtyId, remoteRef, localName)
      onCheckedOut()
      onClose()
    } catch (e) {
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const checkoutDetached = async (ref: string): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      await window.apiary.gitCheckoutDetached(shellKey, isPtyId, ref)
      onCheckedOut()
      onClose()
    } catch (e) {
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const createBranch = async (from?: string): Promise<void> => {
    const name = nameDraft.trim()
    if (name === '') return
    setErrorMessage(null)
    setBusy(true)
    try {
      await window.apiary.gitCreateBranch(shellKey, isPtyId, name, from)
      onCheckedOut()
      onClose()
    } catch (e) {
      reportError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (step.kind === 'name') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal branch-switcher" data-testid="branch-switcher" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
          {errorMessage !== null && (
            <p className="error-banner" data-testid="branch-switcher-error">{errorMessage}</p>
          )}
          <input
            className="search"
            data-testid="branch-switcher-name-input"
            placeholder="Branch name"
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void createBranch(step.from) }}
          />
          <div className="modal-actions">
            <button data-testid="branch-switcher-cancel" onClick={() => { setErrorMessage(null); setStep({ kind: 'list' }) }}>Back</button>
            <button className="primary" data-testid="branch-switcher-confirm" disabled={busy || nameDraft.trim() === ''} onClick={() => { void createBranch(step.from) }}>
              Create branch
            </button>
          </div>
        </div>
      </div>
    )
  }

  const pickingBase = step.kind === 'pick-base' || step.kind === 'pick-detached'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide branch-switcher" data-testid="branch-switcher" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {errorMessage !== null && (
          <p className="error-banner" data-testid="branch-switcher-error">{errorMessage}</p>
        )}
        <input
          className="search"
          data-testid="branch-switcher-search"
          placeholder={pickingBase ? 'Select a ref to branch from' : 'Select a branch or tag to checkout'}
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setErrorMessage(null) }}
        />

        <ul className="branch-switcher-list">
          {!pickingBase && (
            <>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-create" onClick={() => { setErrorMessage(null); setNameDraft(''); setStep({ kind: 'name' }) }}>
                  + Create new branch...
                </button>
              </li>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-create-from" onClick={() => { setErrorMessage(null); setStep({ kind: 'pick-base' }) }}>
                  + Create new branch from...
                </button>
              </li>
              <li>
                <button className="branch-switcher-action" data-testid="branch-switcher-detached" onClick={() => { setErrorMessage(null); setStep({ kind: 'pick-detached' }) }}>
                  Checkout detached...
                </button>
              </li>
            </>
          )}

          {refs === null && <li className="empty">Loading…</li>}

          {refs !== null && (
            <>
              <BranchSection
                title="branches" testId="branch-switcher-branch-row" rows={filtered.local} busy={busy}
                onPick={(r) => {
                  if (step.kind === 'pick-base') { setNameDraft(''); setStep({ kind: 'name', from: r.name }) }
                  else if (step.kind === 'pick-detached') void checkoutDetached(r.name)
                  else void checkout(r.name)
                }}
              />
              <BranchSection
                title="remote branches" testId="branch-switcher-remote-row" rows={filtered.remote} busy={busy}
                onPick={(r) => {
                  if (step.kind === 'pick-base') { setNameDraft(''); setStep({ kind: 'name', from: r.name }) }
                  else if (step.kind === 'pick-detached') void checkoutDetached(r.name)
                  else void checkoutRemote(r.name)
                }}
              />
              <BranchSection
                title="tags" testId="branch-switcher-tag-row" rows={filtered.tags} busy={busy}
                onPick={(r) => {
                  if (step.kind === 'pick-base') { setNameDraft(''); setStep({ kind: 'name', from: r.name }) }
                  else void checkoutDetached(r.name)
                }}
              />
            </>
          )}
        </ul>
      </div>
    </div>
  )
}

function BranchSection(
  { title, testId, rows, onPick, busy }:
  { title: string; testId: string; rows: GitRefEntry[]; onPick: (r: GitRefEntry) => void; busy: boolean },
): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <>
      <li className="branch-switcher-section-label">{title}</li>
      {rows.map((r) => (
        <li key={r.name}>
          <button
            className="branch-switcher-row"
            data-testid={testId}
            disabled={busy}
            onClick={() => onPick(r)}
          >
            <span className="branch-switcher-row-name">{r.name}</span>
            <span className="branch-switcher-row-meta">
              {r.relativeDate} &middot; {r.author} &middot; {r.shortSha} &middot; {r.subject}
            </span>
          </button>
        </li>
      ))}
    </>
  )
}

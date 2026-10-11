import { type JSX, useEffect, useState } from 'react'
import type { GitRefEntry } from '@shared/types'
import { CopyIcon, CheckIcon, ArrowDownIcon } from '../../ui/icons'
import { copyText } from '../../state/clipboard'

/** The rows above the ref list that start something other than a plain checkout. */
export function BranchActions(
  { onCreate, onCreateFrom, onDetached }: { onCreate: () => void; onCreateFrom: () => void; onDetached: () => void },
): JSX.Element {
  return (
    <>
      <li>
        <button className="branch-switcher-action" data-testid="branch-switcher-create" onClick={onCreate}>
          + Create new branch...
        </button>
      </li>
      <li>
        <button className="branch-switcher-action" data-testid="branch-switcher-create-from" onClick={onCreateFrom}>
          + Create new branch from...
        </button>
      </li>
      <li>
        <button className="branch-switcher-action" data-testid="branch-switcher-detached" onClick={onDetached}>
          Checkout detached...
        </button>
      </li>
    </>
  )
}

export function BranchSection(
  { title, testId, rows, onPick, busy, activeName, onUpdate }:
  {
    title: string; testId: string; rows: GitRefEntry[]; onPick: (r: GitRefEntry) => void
    busy: boolean; activeName: string | null
    /** Local branches only: the pull button. */
    onUpdate?: (name: string) => Promise<void>
  },
): JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <>
      <li className="branch-switcher-section-label">{title}</li>
      {rows.map((r) => (
        <li key={r.name} className="branch-switcher-item">
          <button
            className="branch-switcher-row"
            data-testid={testId}
            data-active={r.name === activeName}
            disabled={busy}
            onClick={() => onPick(r)}
          >
            <span className="branch-switcher-row-name">{r.name}</span>
            <span className="branch-switcher-row-meta">
              {r.relativeDate} &middot; {r.author} &middot; {r.shortSha} &middot; {r.subject}
            </span>
          </button>
          {onUpdate !== undefined && <PullRefButton name={r.name} onPull={onUpdate} />}
          <CopyRefButton name={r.name} />
        </li>
      ))}
    </>
  )
}

/**
 * Brings a local branch up to date with its upstream without picking it — beside the copy button,
 * shown the same way. Fast-forward only (see branchOps.updateBranch); busy while it runs, so one
 * click cannot start two pulls.
 */
function PullRefButton({ name, onPull }: { name: string; onPull: (name: string) => Promise<void> }): JSX.Element {
  const [busy, setBusy] = useState(false)
  return (
    <button
      className="branch-switcher-copy branch-switcher-pull"
      data-testid="branch-switcher-pull"
      data-busy={busy}
      disabled={busy}
      title={busy ? `Pulling ${name}…` : `Pull ${name} from its upstream`}
      aria-label={`Pull ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        setBusy(true)
        void onPull(name).finally(() => { setBusy(false) })
      }}
    >
      <ArrowDownIcon />
    </button>
  )
}

/**
 * Copies a ref's name without picking it. A sibling of the row's button rather than inside it — a
 * button cannot hold another — shown on hover or keyboard focus, and enabled even while a checkout
 * is running, since copying changes nothing.
 */
function CopyRefButton({ name }: { name: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => { setCopied(false) }, 1200)
    return () => { clearTimeout(t) }
  }, [copied])
  return (
    <button
      className="branch-switcher-copy"
      data-testid="branch-switcher-copy"
      data-copied={copied}
      title={copied ? 'Copied' : `Copy ${name}`}
      aria-label={`Copy ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        void copyText(name).then((ok) => { if (ok) setCopied(true) })
      }}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </button>
  )
}

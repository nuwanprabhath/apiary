import { type JSX, useRef } from 'react'
import type { WorktreeCreateOptions } from '@shared/domain/git'
import { BRANCH_ROW_SELECTOR } from './branchRows'
import { useRovingList } from '../../ui/useRovingList'

interface Props {
  /** 'branch' picks the branch to check out; 'base' picks what a new branch starts from. */
  mode: 'branch' | 'base'
  options: WorktreeCreateOptions | null
  query: string
  /** The local and remote branches that match the query. */
  local: string[]
  remote: string[]
  busy: boolean
  onQuery: (query: string) => void
  /** A branch was picked: check it out ('branch') or use it as the base ('base'). */
  onPick: (kind: 'local' | 'remote', name: string) => void
  onNewBranch: () => void
  onCurrentHead: () => void
  onBack: () => void
}

/** The branch list of the new-worktree dialog, used for both the checkout and the base step. */
export function WorktreeBranchStep(
  { mode, options, query, local, remote, busy, onQuery, onPick, onNewBranch, onCurrentHead, onBack }: Props,
): JSX.Element {
  const listRef = useRef<HTMLUListElement | null>(null)
  const rows = useRovingList(listRef, { itemSelector: BRANCH_ROW_SELECTOR, wrap: true })
  return (
    <>
      <input
        key={mode}
        className="search"
        data-testid="new-worktree-branch-search"
        placeholder={mode === 'branch' ? 'Select a branch to check out, or create a new one' : 'Filter branches'}
        value={query}
        // eslint-disable-next-line apiary/focus-unless-typing -- the person chose this wizard step, so its field is what they asked for
        autoFocus
        onChange={(e) => { onQuery(e.target.value) }}
        onKeyDown={rows.onKeyDown}
      />
      <ul ref={listRef} className="branch-switcher-list" onKeyDown={rows.onKeyDown}>
        {mode === 'branch' && (
          <li>
            <button
              className="branch-switcher-action"
              data-testid="new-worktree-new-branch"
              disabled={busy}
              onClick={onNewBranch}
            >
              + Create new branch…
            </button>
          </li>
        )}
        {mode === 'base' && (
          <li>
            <button className="branch-switcher-action" data-testid="new-worktree-base-head" onClick={onCurrentHead}>
              Current HEAD
            </button>
          </li>
        )}
        {local.length > 0 && <li className="branch-switcher-section-label">local branches</li>}
        {local.map((b) => {
          const taken = mode === 'branch' && options?.checkedOut.includes(b) === true
          return (
            <li key={`l:${b}`} className="branch-switcher-item">
              <button
                className="branch-switcher-row"
                data-testid="new-worktree-local-row"
                disabled={busy || taken}
                title={taken ? 'Already checked out in another worktree — git allows a branch in one worktree at a time.' : undefined}
                onClick={() => { onPick('local', b) }}
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
              onClick={() => { onPick('remote', b) }}
            >
              <span className="branch-switcher-row-name">{b}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="modal-actions">
        <button type="button" className="btn" data-testid="new-worktree-back" onClick={onBack}>Back</button>
      </div>
    </>
  )
}

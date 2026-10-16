import { useState } from 'react'
import type { GitRefs, WorktreeConflict } from '@shared/types'
import type { GitTarget } from '@shared/domain/git'
import { updateBranchMessage } from '@shared/gitMessages'
import { describeError } from '../../ui/errors'
import * as git from '../../state/git'
import { bestEffort } from '../../state/policy'

interface Deps {
  terminal: GitTarget
  onClose: () => void
  onCheckedOut: () => void
  onWorktreeConflict: (conflict: WorktreeConflict) => void
  onNotice?: (message: string) => void
  onBranchUpdated?: () => void
  /** The ref list changed under a pull: show the new tips. */
  setRefs: (refs: GitRefs) => void
}

/** The error banner is inside the modal, whose backdrop covers everything behind it, so not the parent's `onError` toast. */
export function useBranchActions(
  { terminal, onClose, onCheckedOut, onWorktreeConflict, onNotice, onBranchUpdated, setRefs }: Deps,
) {
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  /**
   * `describeError` strips Electron's IPC wrapping (`Error invoking remote method '…': Error: …`).
   * Success (`onCheckedOut`/`onClose`) is `op`'s to call: `checkout`'s
   * worktree-conflict case closes without either, and a conflicting merge must not close at all.
   */
  const run = async (op: () => Promise<void>): Promise<void> => {
    setErrorMessage(null)
    setBusy(true)
    try {
      await op()
    } catch (e) {
      setErrorMessage(describeError(e).message)
    } finally {
      setBusy(false)
    }
  }
  const done = (): void => { onCheckedOut(); onClose() }

  /** Not routed through `run`: it has per-row busy state (`PullRefButton`) and must not disable the rest of the list. */
  const updateBranch = async (name: string): Promise<void> => {
    setErrorMessage(null)
    try {
      const { commits } = await git.gitUpdateBranch(terminal, name)
      onNotice?.(updateBranchMessage(name, commits))
      onBranchUpdated?.()
      // The row's date, author and subject are the branch tip's, which may just have moved.
      void bestEffort(git.gitRefs(terminal), 'git').then((r) => { if (r !== null) setRefs(r) })
    } catch (e) {
      setErrorMessage(describeError(e).message)
    }
  }

  const checkout = (name: string): Promise<void> => run(async () => {
    const outcome = await git.gitCheckout(terminal, name)
    if (!outcome.ok) {
      // Not an error: hand the conflict up so the choice is made in a dialog.
      onClose()
      onWorktreeConflict(outcome.conflict)
      return
    }
    done()
  })

  const checkoutRemote = (remoteRef: string): Promise<void> => run(async () => {
    const localName = remoteRef.slice(remoteRef.indexOf('/') + 1)
    await git.gitCheckoutRemote(terminal, remoteRef, localName)
    done()
  })

  const checkoutDetached = (ref: string): Promise<void> => run(async () => {
    await git.gitCheckoutDetached(terminal, ref)
    done()
  })

  // A conflicting merge leaves the tree mid-merge on purpose (see branchOps.merge): the popup stays
  // open with git's CONFLICT text rather than closing over a half-merged repo.
  const mergeRef = (ref: string): Promise<void> => run(async () => {
    await git.mergeRef(terminal, ref)
    done()
  })

  const createBranch = (name: string, from?: string): Promise<void> => {
    if (name === '') return Promise.resolve()
    return run(async () => {
      await git.gitCreateBranch(terminal, name, from)
      done()
    })
  }

  return {
    busy, errorMessage, setErrorMessage, updateBranch, checkout, checkoutRemote, checkoutDetached, mergeRef, createBranch,
  }
}

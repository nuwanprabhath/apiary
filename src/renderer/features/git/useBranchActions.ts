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

/**
 * The git actions the branch switcher runs, behind one busy flag and one error banner. Shown
 * inside the modal itself — the modal's own backdrop (position:fixed, full-viewport, 55% black
 * wash) sits above everything behind it, so a failed checkout/create is reported there rather than
 * only through the parent's `onError` (a toast), which would show the same failure a second time
 * and read the Electron IPC wrapping raw if it did (see `run`).
 */
export function useBranchActions(
  { terminal, onClose, onCheckedOut, onWorktreeConflict, onNotice, onBranchUpdated, setRefs }: Deps,
) {
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  /**
   * Runs one git action behind the shared busy flag, with one place that turns a failure into
   * something readable: `describeError` strips Electron's IPC wrapping (`Error invoking remote
   * method '…': Error: …`) rather than showing that raw text in the banner. Reported once, in the
   * banner only — `onError`'s toast would otherwise fire too, and duplicate every failure. Success
   * (`onCheckedOut`/`onClose`) is `op`'s to call, not `run`'s: `checkout`'s worktree-conflict case
   * closes without either, and a conflicting merge must not close at all (see `mergeRef`).
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

  /** The pull button beside a local branch: fast-forwards it from its upstream, in place. Not
   *  routed through `run`: it has its own per-row busy state (`PullRefButton`) and must not
   *  disable the rest of the list while one branch updates. */
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
      // Not an error, and not this popover's to solve: hand the conflict up and get out of the
      // way, so the choice is made in a dialog rather than inside a branch list.
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

  // A conflicting merge leaves the tree mid-merge on purpose (see branchOps.merge), so `run`'s
  // catch reporting the error in the banner, without either onCheckedOut or onClose, is exactly
  // right: the popup stays open with git's own CONFLICT text in it rather than closing over a repo
  // the user now has to notice is halfway through something.
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

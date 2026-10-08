import { asPtyId, type PtyId } from '@shared/domain/ids'
import { useEffect, useMemo } from 'react'
import { useWorkspace } from './useWorkspaceSelector'
import { useWorkspaceDispatch } from './workspaceContext'
import { onAnyPtyExit, runningPtys } from '../../state/terminals'

/**
 * What the main process tells this window about its ptys: an exit (which drops pending entries,
 * dead `new:` tabs and dead shell terminals) and which tabs' ptys are actually running.
 *
 * Nothing here spawns anything — "never spawn over a live id". `resumed` is only ever added to by
 * `pty/running`; the exit event does the tidying.
 */
export function usePtyLifecycle(): void {
  const dispatch = useWorkspaceDispatch()
  const { layout, ptyOverrides } = useWorkspace()
  const columns = layout.panes
  // The effect below depends on this string, not a Set, so it re-runs only when the *set* of open
  // keys changes — not on a tab switch or a move between panes.
  const openKeysSignature = useMemo(
    () => [...new Set(columns.flatMap((c) => c.tabs.map((t) => t.key)))].sort((a, b) => a.localeCompare(b)).join(' '),
    [columns],
  )

  // If a pending pty exits before ever producing a JSONL (the user quits Claude immediately, the
  // binary is missing, etc.) it must stop being tracked as pending rather than lingering forever
  // — nothing will ever resolve it. It is simply no longer "new" at that point: if it did somehow
  // still leave behind a JSONL, that file surfaces later as an ordinary (never-"resumed") session,
  // which is correct, since there is no longer a live process it could conflict with.
  useEffect(() => onAnyPtyExit((id) => {
    // Only a tab still keyed by its `new:` pty id — a session whose process died before it ever
    // had a session id — is closed: there is nothing left in it to show. This used to close the tab
    // of *any* pty that exited (a 1.3.0 generalisation of what had cleared only the pending
    // session), so exiting a resumed session made its tab vanish — and with it the Active row,
    // whose "stopped" dot could therefore never be seen. A real session keeps its tab, transcript
    // and all, and reads as stopped.
    //
    // A shell terminal whose process is gone must stop being listed (typing `exit` at a shell
    // prompt kills that pty, but the tab used to stay behind pointing at it). Both halves, and the
    // pending entry's removal, are one reducer case — see `pty/exited`.
    dispatch({ type: 'pty/exited', id })
  }), [dispatch])

  /**
   * Keeps `resumed` in step with the ptys the main process actually has.
   *
   * `resumed` started life as a record of what *this window* had started, and that was wrong in
   * two ways that both ended at a blank pane: a second window knew nothing of a session the first
   * had opened, and a relaunched window restored a tab still set to its terminal view with no
   * terminal behind it. Whether a session has a process is main-process state, so it is asked for
   * rather than remembered — cheaply, since it is a set-membership test over ids the window
   * already holds.
   *
   * Only ever *adds*: a pty that has gone away arrives as `onPtyExit`, which is the event that
   * knows the exit code and does the rest of the tidying.
   */
  useEffect(() => {
    const keys = openKeysSignature === '' ? [] : openKeysSignature.split(' ')
    if (keys.length === 0) return
    // A pending tab is keyed by its pty id already; a resolved one may have been started under a
    // different pty id, which `ptyOverrides` remembers.
    const ptyIdOf = new Map(keys.map((k): [PtyId, string] => [ptyOverrides.get(k) ?? asPtyId(k), k]))
    // A window that cannot ask (`null`) shows what it knew, which is where it was before this existed.
    void runningPtys([...ptyIdOf.keys()]).then((running) => {
      if (running === null) return
      const live = running.map((id) => ptyIdOf.get(id)).filter((k): k is string => k !== undefined)
      dispatch({ type: 'pty/running', keys: live })
    })
  }, [openKeysSignature, ptyOverrides, dispatch])
}

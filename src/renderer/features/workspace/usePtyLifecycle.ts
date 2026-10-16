import { asPtyId, type PtyId } from '@shared/domain/ids'
import { useEffect, useMemo } from 'react'
import { useWorkspace } from './useWorkspaceSelector'
import { useWorkspaceDispatch } from './workspaceContext'
import { onAnyPtyExit, runningPtys } from '../../state/terminals'

/**
 * Nothing here spawns anything — "never spawn over a live id". `resumed` is only ever added to by
 * `pty/running`; the exit event does the tidying.
 */
export function usePtyLifecycle(): void {
  const dispatch = useWorkspaceDispatch()
  const { layout, ptyOverrides } = useWorkspace()
  const columns = layout.panes
  // A string, not a Set, so the effect below re-runs only when the set of open keys changes.
  const openKeysSignature = useMemo(
    () => [...new Set(columns.flatMap((c) => c.tabs.map((t) => t.key)))].sort((a, b) => a.localeCompare(b)).join(' '),
    [columns],
  )

  // A pending pty that exits before producing a JSONL (Claude quit at once, binary missing) must
  // stop being tracked as pending; nothing will resolve it. Any JSONL it left surfaces later as
  // an ordinary session.
  useEffect(() => onAnyPtyExit((id) => {
    // A real session keeps its tab and transcript and reads as stopped; only a `new:` tab closes.
    dispatch({ type: 'pty/exited', id })
  }), [dispatch])

  /**
   * Whether a session has a process is main-process state, so it is asked for, not remembered: a
   * second window or a relaunched one knows nothing of what another started.
   *
   * Only ever adds: a pty that has gone away arrives as `onPtyExit`, which knows the exit code.
   */
  useEffect(() => {
    const keys = openKeysSignature === '' ? [] : openKeysSignature.split(' ')
    if (keys.length === 0) return
    // A pending tab is keyed by its pty id already; a resolved one may have been started under a
    // different pty id, which `ptyOverrides` remembers.
    const ptyIdOf = new Map(keys.map((k): [PtyId, string] => [ptyOverrides.get(k) ?? asPtyId(k), k]))
    // A window that cannot ask (`null`) keeps what it knew.
    void runningPtys([...ptyIdOf.keys()]).then((running) => {
      if (running === null) return
      const live = running.map((id) => ptyIdOf.get(id)).filter((k): k is string => k !== undefined)
      dispatch({ type: 'pty/running', keys: live })
    })
  }, [openKeysSignature, ptyOverrides, dispatch])
}

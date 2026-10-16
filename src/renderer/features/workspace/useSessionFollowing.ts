import { asPtyId, type PtyId } from '@shared/domain/ids'
import { useEffect, useRef } from 'react'
import type { SessionNode } from '@shared/types'
import { treeStore } from '../../state/treeStore'
import { usePtySessions } from '../../state/ptySessionsStore'
import { flattenTree, findNewSessionByCwd } from '@shared/treeWalk'
import { useWorkspace } from './useWorkspaceSelector'
import { useWorkspaceDispatch } from './workspaceContext'
import { background } from '../../state/policy'
import { renameSession } from '../../state/sessions'
import { logLine } from '../../state/log'

/**
 * Keeps tabs on the session their terminal is actually on: folds a pending new session into its
 * real `SessionNode` once the watcher finds it (the reconciler), and rekeys a live tab whose pty
 * Claude reports on another session (the rekey). Both end in the same `session/follow` action.
 *
 * Neither effect ever spawns a pty — "never spawn over a live id" depends on the rekey putting the
 * pty id in `ptyOverrides` in the same update as the tab's new key.
 */
export function useSessionFollowing(): void {
  const dispatch = useWorkspaceDispatch()
  const { layout, ptyOverrides, pending } = useWorkspace()
  const columns = layout.panes
  const ptySessions = usePtySessions()

  // Folds each still-pending entry into the SessionNode Claude's JSONL write eventually produces:
  // same pty id, now addressed by its real session id, so no second terminal is spawned.
  //
  // Every pending entry is reconciled on each tick, so a second "+" before the first resolves
  // never orphans the first pty. Matching by cwd alone is ambiguous, so a candidate is excluded
  // once it (a) existed before this entry was created (`knownSessionIds`), (b) was claimed earlier
  // in this pass (`claimed`), or (c) was claimed in an earlier pass (`ptyOverrides`, fresh here
  // because resolving an entry changes `pending`, which re-creates this effect). One case stays
  // irreducible: two new sessions in the same folder whose JSONLs first appear in the same tick.
  // Which pty gets which id is then arbitrary, but each gets a distinct, unclaimed one.
  useEffect(() => {
    if (pending.size === 0) return
    let cancelled = false
    const check = (): void => {
      // Re-run on every `treeChanged`, so a failed read just means this pass finds nothing new.
      background(treeStore.current().then((nodes) => {
        if (cancelled) return
        const claimed = new Set<string>()
        for (const [ptyId, info] of pending) {
          // Claude says which session this pty is on; the effect below rekeys it exactly. Guessing
          // from the folder as well could pick a different session and claim it first.
          if (ptySessions[ptyId] !== undefined) continue
          const exclude = new Set([...info.knownSessionIds, ...claimed, ...ptyOverrides.keys()])
          const found = findNewSessionByCwd(nodes, info.cwd, exclude)
          if (!found) continue
          claimed.add(found.sessionId)
          // A rename typed while pending (PendingSession.titleOverride) had nothing to persist
          // against until a real session id exists. `session/follow` applies it to the node too,
          // so the header does not flash the scanner's title until `treeChanged` round-trips.
          if (info.titleOverride !== null) {
            renameSession(found.sessionId, info.titleOverride)
          }
          dispatch({ type: 'session/follow', from: ptyId, to: found, ptyId: info.ptyId, titleOverride: info.titleOverride })
        }
      }), 'tabs')
    }
    check()
    const off = treeStore.onChanged(check)
    return () => { cancelled = true; off() }
  }, [pending, ptyOverrides, ptySessions, dispatch])

  /**
   * The process behind a tab can move: a new or forked session starts under a `new:<uuid>` pty id
   * and only later has an id of its own, and `/clear` or `/resume` switch it in place. The folder
   * matching above cannot see those (it excludes a session that already existed).
   *
   * `ptySessions` is Claude's own answer (`~/.claude/sessions/<pid>.json`), so no matching is
   * needed: a tab whose pty is on another session the tree knows is rekeyed to it, carrying its
   * pty, shells and any pending rename. It works in any window, including one a tab was moved into
   * while pending. A session with no JSONL yet is not in the tree, so the tab waits, never guesses.
   */
  /** Waits already logged by the effect below, so each is logged once rather than per tree change. */
  const loggedWaitsRef = useRef(new Set<string>())
  // Read through a ref so switching or moving tabs, which does not change *which* keys are open,
  // does not refetch the tree; `rekeyOpenKeysSignature` (the open key set) is the dependency.
  const columnsRef = useRef(columns)
  columnsRef.current = columns
  const rekeyOpenKeysSignature = [...new Set(columns.flatMap((c) => c.tabs.map((t) => t.key)))]
    .sort((a, b) => a.localeCompare(b)).join(' ')
  useEffect(() => {
    if (Object.keys(ptySessions).length === 0) return
    let cancelled = false
    // Re-checked on every tree change, not only when `ptySessions` changes. Claude writes its
    // session file at startup but the session's JSONL only on the first message, so the first
    // check finds nothing in the tree and `ptySessions` never changes again to prompt another.
    const check = (): void => {
      background(treeStore.current().then((nodes) => {
      if (cancelled) return
      const known = flattenTree(nodes)
      const openKeys = new Set(columnsRef.current.flatMap((c) => c.tabs.map((t) => t.key)))
      const moves: Array<{ from: string; to: SessionNode; ptyId: PtyId }> = []
      for (const key of openKeys) {
        const ptyId = ptyOverrides.get(key) ?? asPtyId(key)
        const now = ptySessions[ptyId]?.sessionId
        if (now === undefined || now === key) continue
        const target = known.get(now)
        // Not in the tree yet (no message sent in it), or already open in its own tab here —
        // rekeying onto an open tab would leave two tabs claiming one key.
        if (target === undefined || openKeys.has(now)) {
          const waitKey = `${key}>${now}`
          if (!loggedWaitsRef.current.has(waitKey)) {
            loggedWaitsRef.current.add(waitKey)
            logLine('info', 'tabs', 'tab not following its terminal yet', {
              key, ptyId, session: now,
              reason: target === undefined ? 'no transcript yet' : 'session already open in another tab',
            })
          }
          continue
        }
        moves.push({ from: key, to: target, ptyId })
      }
      if (moves.length === 0) return
      for (const { from, to, ptyId } of moves) {
        logLine('info', 'tabs', 'tab follows its terminal', {
          from, to: to.sessionId, ptyId, wasPending: pending.has(from),
        })
        const titleOverride = pending.get(from)?.titleOverride ?? null
        if (titleOverride !== null) {
          renameSession(to.sessionId, titleOverride)
        }
        // Shells stay where they are: they are filed by the pty the tab runs under (see
        // `keyFor`), which is `ptyId` before this and — through the override — after it. The tab
        // stays on the terminal view: it was showing a live process, and still is.
        dispatch({ type: 'session/follow', from, to, ptyId, titleOverride })
      }
      }), 'tabs')
    }
    check()
    const off = treeStore.onChanged(check)
    return () => { cancelled = true; off() }
  }, [ptySessions, rekeyOpenKeysSignature, ptyOverrides, pending, dispatch])
}

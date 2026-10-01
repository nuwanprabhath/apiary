import { asPtyId, type PtyId } from '@shared/domain/ids'
import { useEffect, useRef } from 'react'
import type { SessionNode } from '@shared/types'
import { treeStore } from '../../state/treeStore'
import { usePtySessions } from '../../state/usePtySessions'
import { useNotifications } from '../../ui/notifications'
import { flattenTree, findNewSessionByCwd } from './treeLookup'
import { useWorkspace, useWorkspaceDispatch } from './WorkspaceProvider'

/**
 * Keeps tabs on the session their terminal is actually on: folds a pending new session into its
 * real `SessionNode` once the watcher finds it (the reconciler), and rekeys a live tab whose pty
 * Claude reports on another session (the rekey). Both end in the same `session/follow` action.
 *
 * Side effects (the rename IPC, the log line) are decided here; the state change is one dispatch.
 * Neither effect ever spawns a pty — "never spawn over a live id" depends on the rekey putting the
 * pty id in `ptyOverrides` in the same update as the tab's new key.
 */
export function useSessionFollowing(): void {
  const { notifyError } = useNotifications()
  const dispatch = useWorkspaceDispatch()
  const { layout, ptyOverrides, pending } = useWorkspace()
  const columns = layout.panes
  /** Which Claude session each terminal is on, from Claude itself — see the rekey effect. */
  const ptySessions = usePtySessions()

  // Once a "new session" pty is running (either entry point), watch for the SessionNode Claude's
  // own JSONL write eventually produces. When it appears, fold the pending terminal into the
  // normal resumed-session bookkeeping — same pty id, now addressed by its real session id — so
  // there is never a second terminal spawned for the same running process.
  //
  // Every still-pending entry is reconciled independently on each tick, not just the visible one,
  // so a second "+" click (on the same folder or a different one) before the first resolves can
  // never orphan the first pty. Matching by cwd alone is ambiguous when a folder already holds —
  // or is about to hold — more than one new session, so a candidate is excluded once it is: (a) an
  // id that already existed before this particular pending entry was created (`knownSessionIds`),
  // (b) claimed by another pending entry earlier in this same pass (`claimed`), or (c) claimed by
  // any pending entry in an earlier pass (`ptyOverrides`, which accumulates for the app's lifetime
  // and is fresh here because resolving an entry changes `pending`, which re-creates this effect
  // with a closure over the latest `ptyOverrides`). That leaves exactly one irreducible case: two
  // brand-new sessions in the *same* folder whose JSONLs both appear for the very first time in
  // the very same tick. Nothing distinguishes them from cwd alone, so which pty gets labelled
  // which session id is arbitrary — but each still gets a distinct, unclaimed one, so neither pty
  // is ever orphaned and neither session ever ends up double-claimed.
  useEffect(() => {
    if (pending.size === 0) return
    let cancelled = false
    const check = (): void => {
      // Background (UI-23): re-run on every `treeChanged`, so a failed read here just means this
      // pass finds nothing new — the next tree change gives it another chance.
      void treeStore.current().then((nodes) => {
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
          // A rename typed in while this was still pending (see PendingSession.titleOverride)
          // had nowhere to persist against until now — apply it the moment a real session id
          // exists. Applied optimistically to the SessionNode used below too, so the header
          // shows the renamed title immediately rather than flashing the scanner's own title
          // until the resulting `treeChanged` push round-trips back.
          if (info.titleOverride !== null) {
            void window.apiary.renameSession(found.sessionId, info.titleOverride).catch((e: unknown) => {
              notifyError(e, 'Could not rename the session')
            })
          }
          // `session/follow` also applies the override title to the node, takes the pty over
          // (`ptyOverrides`), marks it resumed, rekeys the tab in place — wherever it is — onto the
          // terminal view and drops the pending entry: one atomic update.
          dispatch({ type: 'session/follow', from: ptyId, to: found, ptyId: info.ptyId, titleOverride: info.titleOverride })
        }
      }).catch(() => {})
    }
    check()
    const off = window.apiary.onTreeChanged(check)
    return () => { cancelled = true; off() }
  }, [pending, ptyOverrides, notifyError, ptySessions, dispatch])

  /**
   * Keeps every tab on the session its terminal is *actually* on, as Claude reports it.
   *
   * A tab is keyed by a session id, but the process behind it can move: a new or forked session
   * starts under a `new:<uuid>` pty id and only later has an id of its own, and `/clear` or
   * `/resume` typed in any session switch the process to another session in place. The folder
   * matching above can only guess at the first case and cannot see the others — a new session in
   * which you typed `/resume` switched to a session that already existed, which that matching
   * deliberately excludes, so the tab stayed `new:<uuid>` for good: unpinnable, absent from
   * Recent, showing its pty id in Active, and unforkable.
   *
   * `ptySessions` is Claude's own answer (`~/.claude/sessions/<pid>.json`), so no matching is
   * needed: a tab whose pty is on another session that the tree knows is rekeyed to it, carrying
   * its pty, its shells and any rename typed while it was pending. It works in any window,
   * including one a tab was moved into while still pending, which never had a pending entry for
   * it at all. A session with no JSONL yet (nothing has been typed in it) is not in the tree, so
   * the tab simply waits — never guesses.
   */
  /** Waits already logged by the effect below, so each is logged once rather than per tree change. */
  const loggedWaitsRef = useRef(new Set<string>())
  // UI-3: read through a ref inside the effect below rather than depending on `columns` directly,
  // so switching the active tab or moving one between panes — neither of which changes *which*
  // keys are open — does not refetch the tree. `rekeyOpenKeysSignature` (just the open key set,
  // order-independent) is what the effect actually depends on.
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
    // Missed by a stand-in whose session already existed; caught by the live Haiku spec.
    const check = (): void => {
      // Background (UI-23): re-run on every `treeChanged`, so a failed read here just means this
      // pass finds nothing new — the next tree change gives it another chance.
      void treeStore.current().then((nodes) => {
      if (cancelled) return
      const known = flattenTree(nodes)
      const openKeys = new Set(columnsRef.current.flatMap((c) => c.tabs.map((t) => t.key)))
      const moves: Array<{ from: string; to: SessionNode; ptyId: PtyId }> = []
      for (const key of openKeys) {
        const ptyId = asPtyId(ptyOverrides.get(key) ?? key)
        const now = ptySessions[ptyId]?.sessionId
        if (now === undefined || now === key) continue
        const target = known.get(now)
        // Not in the tree yet (no message sent in it), or already open in its own tab here —
        // rekeying onto an open tab would leave two tabs claiming one key.
        if (target === undefined || openKeys.has(now)) {
          // Logged once per wait: "Active still shows new:…" was unanswerable from the log, which
          // showed the terminal on a session and then nothing. This says why it did not follow.
          const waitKey = `${key}>${now}`
          if (!loggedWaitsRef.current.has(waitKey)) {
            loggedWaitsRef.current.add(waitKey)
            window.apiary.logWrite('info', 'tabs', 'tab not following its terminal yet', {
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
        // Logged because a tab stuck on the wrong session was invisible from outside: which tab
        // was rekeyed, from what to what, and whether it had been pending.
        window.apiary.logWrite('info', 'tabs', 'tab follows its terminal', {
          from, to: to.sessionId, ptyId, wasPending: pending.has(from),
        })
        const titleOverride = pending.get(from)?.titleOverride ?? null
        if (titleOverride !== null) {
          void window.apiary.renameSession(to.sessionId, titleOverride).catch((e: unknown) => {
            notifyError(e, 'Could not rename the session')
          })
        }
        // Shells stay where they are: they are filed by the pty the tab runs under (see
        // `keyFor`), which is `ptyId` before this and — through the override — after it. The tab
        // stays on the terminal view: it was showing a live process, and still is.
        dispatch({ type: 'session/follow', from, to, ptyId, titleOverride })
      }
      }).catch(() => {})
    }
    check()
    const off = window.apiary.onTreeChanged(check)
    return () => { cancelled = true; off() }
  }, [ptySessions, rekeyOpenKeysSignature, ptyOverrides, pending, notifyError, dispatch])
}

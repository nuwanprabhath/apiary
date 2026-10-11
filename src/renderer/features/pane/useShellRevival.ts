import { useEffect, useRef, useState } from 'react'
import type { PtyId } from '@shared/domain/ids'
import { useNotifications } from '../../ui/notifications'
import { runningPtys } from '../../state/terminals'
import { logLine } from '../../state/log'

/**
 * Starts a listed terminal again when it comes on screen with no process behind it.
 *
 * Shells end with the app, but the restored layout still lists them — and "Show shell" only
 * spawns for a session with *no* terminal listed, so after a relaunch it found the listing,
 * spawned nothing, and showed a pty that no longer existed: a blinking cursor with no prompt,
 * which hiding and showing again could not fix, while "+" (a new id) worked. The terminal is
 * restarted under its own id and name, so the list the user arranged stays as it was.
 *
 * `shownShellPty` is the pty of the terminal now on screen (null: none is). Returns the revival
 * count per pty, bumped so the view remounts and attaches the way a fresh terminal's does.
 */
export function useShellRevival(
  shownShellPty: PtyId | null,
  currentTerminalId: string | null,
  spawnTerminal: (id: string) => Promise<void>,
): Map<string, number> {
  const { notifyError } = useNotifications()
  const [revivals, setRevivals] = useState<Map<string, number>>(() => new Map())
  const revivingRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    if (shownShellPty === null || currentTerminalId === null) return
    if (revivingRef.current.has(shownShellPty)) return
    let cancelled = false
    const ptyId = shownShellPty
    const terminalId = currentTerminalId
    void runningPtys([ptyId]).then(async (running) => {
      // Not knowing is not a reason to start a second process over a live id.
      if (cancelled || running === null || running.includes(ptyId)) return
      revivingRef.current.add(ptyId)
      logLine('info', 'shell', 'restarting a listed terminal with no process', { ptyId })
      try {
        await spawnTerminal(terminalId)
        setRevivals((prev) => new Map(prev).set(ptyId, (prev.get(ptyId) ?? 0) + 1))
      } catch (e: unknown) {
        notifyError(e, 'Could not restart the shell')
      } finally {
        revivingRef.current.delete(ptyId)
      }
    })
    return () => { cancelled = true }
  }, [shownShellPty, currentTerminalId, spawnTerminal, notifyError])

  return revivals
}

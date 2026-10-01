import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus } from '@shared/types'
import type { TerminalRef } from '@shared/domain/ids'

/**
 * The branch state of what is in front of a pane, read again whenever it could have changed.
 *
 * `terminal` names what the pane's git calls address (a session or a pty, see `TerminalRef`);
 * null while no tab is open.
 */
export function useGitStatus(terminal: TerminalRef | null): {
  gitStatus: GitStatus | null
  loadGitStatus: () => void
} {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  /** Which tab's `gitStatus` request is the current one — see `loadGitStatus` (UI-14). */
  const requestKey = useRef<string | null>(null)

  const loadGitStatus = useCallback(() => {
    if (terminal === null) { setGitStatus(null); return }
    // Guarded the way `useTree`'s `requestId` is: a slower response for a tab you have since
    // switched away from must never overwrite the toolbar with the wrong repo's branch.
    const key = terminal.id
    requestKey.current = key
    void window.apiary.gitStatus(terminal)
      .then((status) => { if (requestKey.current === key) setGitStatus(status) })
      .catch(() => { if (requestKey.current === key) setGitStatus(null) })
  }, [terminal])

  useEffect(() => { loadGitStatus() }, [loadGitStatus])

  /**
   * Re-read the branch on a timer, because the most common way to change branch in this app is to
   * type `git checkout` into the very terminal sitting below this toolbar — and nothing about that
   * is observable from here, so without polling the label goes stale and quietly lies.
   *
   * This is not the background *fetching* the packaging notes rule out: every call is a local
   * `git rev-parse` against an already-known directory, no network. Polls are skipped entirely
   * while the window is unfocused, so an app left open in the background costs nothing, and a
   * focus listener catches up the moment you come back.
   */
  useEffect(() => {
    if (terminal === null) return
    const tick = (): void => { if (document.hasFocus()) loadGitStatus() }
    const timer = setInterval(tick, 5000)
    window.addEventListener('focus', loadGitStatus)
    return () => { clearInterval(timer); window.removeEventListener('focus', loadGitStatus) }
  }, [terminal, loadGitStatus])

  return { gitStatus, loadGitStatus }
}

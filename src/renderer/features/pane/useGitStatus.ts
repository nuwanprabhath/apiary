import { useCallback, useEffect, useRef, useState } from 'react'
import type { GitStatus } from '@shared/types'
import type { TerminalRef } from '@shared/domain/ids'
import { readGitStatus } from '../../state/git'
import { onFocusedTick } from '../../state/focusedTick'

function sameGitStatus(a: GitStatus | null, b: GitStatus | null): boolean {
  if (a === null || b === null) return a === b
  return a.branch === b.branch && a.ahead === b.ahead && a.behind === b.behind && a.hasUpstream === b.hasUpstream
}

/** `terminal` names what the pane's git calls address (see `TerminalRef`); null while no tab is open. */
export function useGitStatus(terminal: TerminalRef | null): {
  gitStatus: GitStatus | null
  loadGitStatus: () => void
} {
  const [gitStatus, setGitStatus] = useState<GitStatus | null>(null)
  const requestKey = useRef<string | null>(null)

  const loadGitStatus = useCallback(() => {
    if (terminal === null) { setGitStatus(null); return }
    // A slower response for a tab since switched away from must not overwrite the branch.
    const key = terminal.id
    requestKey.current = key
    // An unchanged answer keeps the old object, or every pane renders on each focused tick.
    void readGitStatus(terminal).then((status) => {
      if (requestKey.current === key) setGitStatus((old) => (sameGitStatus(old, status) ? old : status))
    })
  }, [terminal])

  useEffect(() => { loadGitStatus() }, [loadGitStatus])

  // Branches mostly change by typing `git checkout` into the terminal below, which is not
  // observable from here, so poll on the focused-window tick. Local `git rev-parse` only, no
  // network, and skipped while unfocused; the focus listener catches up on return.
  useEffect(() => {
    if (terminal === null) return
    const stopTicking = onFocusedTick(loadGitStatus)
    window.addEventListener('focus', loadGitStatus)
    return () => { stopTicking(); window.removeEventListener('focus', loadGitStatus) }
  }, [terminal, loadGitStatus])

  return { gitStatus, loadGitStatus }
}

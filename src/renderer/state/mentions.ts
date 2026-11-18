import { useEffect, useState } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { RepoWebLocation } from '@shared/mentions/repoWebLocation'
import { bestEffort, surface } from './policy'

/**
 * The web page of a session's repository, for linking `#12` and `!34` in its messages; null until
 * main answers, and when it has none. Asked once per mount: main caches it per folder.
 */
export function useRepoWebLocation(sessionId: SessionId | null): RepoWebLocation | null {
  const [location, setLocation] = useState<{ sessionId: SessionId; repo: RepoWebLocation | null } | null>(null)
  useEffect(() => {
    if (sessionId === null) return undefined
    let live = true
    const asked = bestEffort(window.apiary.repoWebLocation({ kind: 'session', id: sessionId }), 'git')
    void asked.then((repo) => { if (live) setLocation({ sessionId, repo: repo ?? null }) })
    return () => { live = false }
  }, [sessionId])
  return location !== null && location.sessionId === sessionId ? location.repo : null
}

/** Opens a reference link from a message in the browser of the machine in front of the person. */
export function openReferenceLink(href: string): void {
  surface(window.apiary.openTerminalLink(href), 'Could not open that link')
}

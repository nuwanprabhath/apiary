import { useEffect, useState } from 'react'
import type { PtySessionInfo } from '@shared/api'

/** pty id → the Claude session its process is on now, kept live — see claudeSessionTracker.ts. */
export function usePtySessions(): Record<string, PtySessionInfo> {
  const [sessions, setSessions] = useState<Record<string, PtySessionInfo>>({})
  useEffect(() => {
    let cancelled = false
    void window.apiary.ptySessions().then((s) => { if (!cancelled) setSessions(s) }).catch(() => { /* unknown */ })
    const off = window.apiary.onPtySessionsChanged((s) => { if (!cancelled) setSessions(s) })
    return () => { cancelled = true; off() }
  }, [])
  return sessions
}

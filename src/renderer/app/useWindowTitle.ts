import { useEffect } from 'react'
import { TITLE_SUFFIX } from '@shared/domain/appWindows'
import { remoteHost } from '../state/windowParams'

/**
 * Names the window after its active tab ("Fix CSV export bug — Apiary"), and a remote one after its
 * host as well. The OS's window list shows it, and so do the status bar's window buttons, which
 * read it back from main (`appWindows`).
 */
export function useWindowTitle(activeTitle: string | null): void {
  useEffect(() => {
    const host = remoteHost()
    const parts = [activeTitle, host].filter((p): p is string => p !== null && p !== '')
    document.title = parts.length === 0 ? 'Apiary' : `${parts.join(' — ')}${TITLE_SUFFIX}`
  }, [activeTitle])
}

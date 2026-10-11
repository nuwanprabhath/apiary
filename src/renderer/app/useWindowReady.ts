import { useEffect } from 'react'

/**
 * Marks the window ready (`data-ready` on <html>). Call it after every other hook of the window on
 * purpose: effects run children first, then in declaration order, so by the time this one runs every
 * IPC subscription the window makes (`onTabAdopt` included) is in place. The e2e harness waits for it
 * before treating a new window as one that can be handed a tab — under React 19 a window could be
 * "loaded" and still not listening.
 */
export function useWindowReady(): void {
  useEffect(() => {
    document.documentElement.dataset.ready = 'true'
  }, [])
}

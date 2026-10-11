import { type JSX, useCallback, useRef, useState } from 'react'
import type { NewSessionInfo } from '@shared/domain/session'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { FolderBrowserDialog } from './FolderBrowserDialog'

/**
 * Asks for a folder on the work machine. `request()` shows the browser and resolves with the
 * session it started, or null when it was closed; `element` is the dialog to render while one is open.
 */
export function useFolderBrowserRequest(host: string | null): {
  request: () => Promise<NewSessionInfo | null>
  element: JSX.Element | null
} {
  const [open, setOpen] = useState(false)
  const settle = useRef<((info: NewSessionInfo | null) => void) | null>(null)

  const finish = useCallback((info: NewSessionInfo | null): void => {
    settle.current?.(info)
    settle.current = null
    setOpen(false)
  }, [])
  const request = useCallback((): Promise<NewSessionInfo | null> => {
    settle.current?.(null) // a second request replaces the first
    return new Promise((resolve) => {
      settle.current = resolve
      setOpen(true)
    })
  }, [])

  const element = open && host !== null
    ? (
      // A fault in the dialog closes it (the request resolves with nothing) instead of blanking the window.
      <ErrorBoundary label="The folder browser" fallback={null} onError={() => { finish(null) }}>
        <FolderBrowserDialog host={host} onStarted={finish} onClose={() => { finish(null) }} />
      </ErrorBoundary>
    )
    : null
  return { request, element }
}

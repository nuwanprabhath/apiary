import { type JSX, useCallback, useRef, useState } from 'react'
import type { NewSessionInfo } from '@shared/domain/session'
import { DialogBoundary } from '../dialogs'
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
      // A fault in the dialog shows `DialogBoundary`'s own closable dialog instead of blanking the
      // window; closing it, like closing the browser, resolves the request with nothing.
      <DialogBoundary onClose={() => { finish(null) }}>
        <FolderBrowserDialog host={host} onStarted={finish} onClose={() => { finish(null) }} />
      </DialogBoundary>
    )
    : null
  return { request, element }
}

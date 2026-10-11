import { type JSX, useEffect, useState } from 'react'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { DialogBoundary } from '../dialogs'
import { onOpenRemoteDialog } from '../../state/remote'
import { useRemoteStatus } from '../../state/remoteStatusStore'
import { remoteHost } from '../../state/windowParams'
import { RemoteBanner } from './RemoteBanner'
import { RemoteDialog } from './RemoteDialog'

/** The connect dialog (any window) and, in a remote window, the disconnected banner. */
export function RemoteView(): JSX.Element {
  const host = remoteHost()
  const [dialogOpen, setDialogOpen] = useState(false)
  const status = useRemoteStatus()

  useEffect(() => onOpenRemoteDialog(() => { setDialogOpen(true) }), [])
  useEffect(() => {
    if (host !== null) document.title = `${host} — Apiary`
  }, [host])

  return (
    <>
      {host !== null && (status?.state === 'disconnected' || status?.state === 'reconnecting') && (
        <ErrorBoundary label="The connection banner" compact resetKey={status}>
          <RemoteBanner status={status} />
        </ErrorBoundary>
      )}
      {dialogOpen && (
        <DialogBoundary onClose={() => { setDialogOpen(false) }}>
          <RemoteDialog onClose={() => { setDialogOpen(false) }} />
        </DialogBoundary>
      )}
    </>
  )
}

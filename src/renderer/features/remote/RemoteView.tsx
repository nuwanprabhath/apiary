import { type JSX, useEffect, useState } from 'react'
import type { RemoteStatus } from '@shared/domain/remote'
import { onOpenRemoteDialog, onRemoteStatus } from '../../state/remote'
import { remoteHost } from '../../state/windowParams'
import { RemoteBanner } from './RemoteBanner'
import { RemoteDialog } from './RemoteDialog'

/** The connect dialog (any window) and, in a remote window, the disconnected banner. */
export function RemoteView(): JSX.Element {
  const host = remoteHost()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [status, setStatus] = useState<RemoteStatus | null>(null)

  useEffect(() => onOpenRemoteDialog(() => { setDialogOpen(true) }), [])
  useEffect(() => {
    if (host === null) return undefined
    return onRemoteStatus(setStatus)
  }, [host])
  useEffect(() => {
    if (host !== null) document.title = `${host} — Apiary`
  }, [host])

  return (
    <>
      {host !== null && (status?.state === 'disconnected' || status?.state === 'reconnecting') &&<RemoteBanner status={status} />}
      {dialogOpen && <RemoteDialog onClose={() => { setDialogOpen(false) }} />}
    </>
  )
}

import { type JSX, useState } from 'react'
import type { RemoteStatus } from '@shared/domain/remote'
import { AlertIcon, RefreshIcon } from '../../ui/icons'
import { closeThisWindow, connectRemote, remoteFailureText } from '../../state/remote'

/**
 * The strip a remote window shows once its connection is gone. It sits in the layout's flow, below
 * the title bar, so it pushes the content down rather than covering it. Reconnect opens a fresh
 * window through main, so on success this one has nothing left to show and closes.
 */
export function RemoteBanner({ status }: { status: RemoteStatus }): JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reconnect = (): void => {
    setBusy(true)
    setError(null)
    connectRemote(status.host).then(
      closeThisWindow,
      (thrown: unknown) => { setError(remoteFailureText(thrown)); setBusy(false) },
    )
  }

  if (status.state === 'reconnecting') {
    return (
      <div className="remote-banner reconnecting" role="status" data-testid="remote-banner">
        <RefreshIcon className="remote-banner-icon spinner" />
        <div className="remote-banner-text">
          <strong>Reconnecting to {status.host}…{status.attempt !== undefined && ` (attempt ${String(status.attempt)})`}</strong>
          {status.message !== undefined && <span data-testid="remote-banner-message">{status.message}</span>}
        </div>
        <div className="remote-banner-actions">
          <button className="btn small" data-testid="remote-close-window" onClick={closeThisWindow}>Close window</button>
        </div>
      </div>
    )
  }

  return (
    <div className="remote-banner" role="alert" data-testid="remote-banner">
      <AlertIcon className="remote-banner-icon" />
      <div className="remote-banner-text">
        <strong>Disconnected from {status.host}.</strong>
        {(error ?? status.message) !== undefined && <span data-testid="remote-banner-message">{error ?? status.message}</span>}
      </div>
      <div className="remote-banner-actions">
        <button className="btn small" data-testid="remote-reconnect" disabled={busy} onClick={reconnect}>
          {busy ? 'Reconnecting…' : 'Reconnect'}
        </button>
        <button className="btn small" data-testid="remote-close-window" onClick={closeThisWindow}>Close window</button>
      </div>
    </div>
  )
}

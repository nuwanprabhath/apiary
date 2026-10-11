import { type JSX, useEffect, useState } from 'react'
import type { RemoteHost } from '@shared/domain/remote'
import { background } from '../../state/policy'
import { loadRemoteHosts, remoteFailureText, startRemoteAndConnect } from '../../state/remote'

/** What main says when the socket could not be reached (`NOT_ACCEPTING` in `remoteClientService.ts`): Apiary may simply not be running. */
export function isUnreachableText(text: string): boolean {
  return text.includes('is not accepting remote connections')
}

/**
 * Under the connect dialog's error (or from a host row marked "not running"): Apiary is installed on
 * `host` but not running, so offer to start it there and connect. `since` is when the failure
 * happened: only a probe made after it counts as "fresh" (0 for a row, whose status is the offer).
 * A failure to start is handed back as text for the dialog's own error line.
 */
/** Whether a probe made since `since` says `host` is installed but not running: when the offer shows. */
export function offerShows(host: string, hosts: readonly RemoteHost[], since: number): boolean {
  const probed = hosts.find((h) => h.name === host)
  return probed?.status === 'stopped' && (probed.checkedAt ?? 0) >= since
}

export function StartRemoteOffer({ host, hosts, since, disabled, onWorking, onStarted, onFailed }: {
  host: string
  hosts: RemoteHost[]
  since: number
  disabled: boolean
  onWorking: (working: boolean) => void
  onStarted: () => void
  onFailed: (text: string) => void
}): JSX.Element | null {
  const [starting, setStarting] = useState(false)
  // A fresh probe of the host: the answers arrive through the dialog's `remoteHostsChanged` listener.
  useEffect(() => { if (since > 0) background(loadRemoteHosts(true), 'remote') }, [host, since])

  if (!starting && !offerShows(host, hosts, since)) return null

  const start = (): void => {
    setStarting(true)
    onWorking(true)
    startRemoteAndConnect(host).then(
      onStarted,
      (thrown: unknown) => { setStarting(false); onWorking(false); onFailed(remoteFailureText(thrown)) },
    )
  }

  return (
    <div className="remote-offer" data-testid="remote-offer">
      {starting
        ? (
          <p className="remote-offer-text" role="status" data-testid="remote-offer-starting">
            <span className="btn-spinner" aria-hidden="true" />
            <span>Starting Apiary on {host}…</span>
          </p>
        )
        : (
          <>
            <p className="remote-offer-text">Apiary isn&apos;t running on {host}.</p>
            <button type="button" className="btn primary" data-testid="remote-start" disabled={disabled} onClick={start}>
              Start Apiary and connect
            </button>
          </>
        )}
    </div>
  )
}

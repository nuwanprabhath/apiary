import { type JSX, useEffect, useState } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { clockTime } from '@shared/domain/remote'
import { copyText } from '../../../state/clipboard'
import { disconnectAllRemote, loadPairingCode, newPairingCode, useRemoteClients } from '../../../state/remoteAccess'
import { remoteFailureText } from '../../../state/remote'
import { CheckboxSetting } from '../fields/CheckboxSetting'

type Patch = (fields: Partial<AppSettingsPayload>) => void

/**
 * Settings → General → "Allow remote access over SSH" with what hangs off it: who is connected now
 * and "Disconnect all…", and the optional pairing code. Disconnecting turns remote access off in
 * main at once (the home side reconnects by itself otherwise), so the draft is switched off too, or
 * Save would turn it back on.
 */
export function RemoteAccessSetting({ draft, patch }: { draft: AppSettingsPayload; patch: Patch }): JSX.Element {
  return (
    <>
      <CheckboxSetting
        testId="setting-remote-access"
        checked={draft.remoteAccess}
        onChange={(checked) => { patch({ remoteAccess: checked }) }}
        label="Allow remote access over SSH"
        help={(
          <>
            Your other Mac or PC connects with File → Open Remote Session, over SSH. Apiary opens
            no network port.
          </>
        )}
      />
      <CheckboxSetting
        testId="setting-remote-pairing"
        checked={draft.remoteAccessPairing}
        onChange={(checked) => { patch({ remoteAccessPairing: checked }) }}
        label="Also require a pairing code"
        help="SSH stays the sign-in. The code is an extra the other machine has to know."
      />
      {draft.remoteAccessPairing && <PairingCode />}
      <ConnectedClients patch={patch} />
    </>
  )
}

function PairingCode(): JSX.Element {
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    void loadPairingCode().then((c) => { if (live) setCode(c) })
    return () => { live = false }
  }, [])
  const renew = (): void => {
    setError(null)
    newPairingCode().then((c) => { setCode(c); setCopied(false) }, (thrown: unknown) => { setError(remoteFailureText(thrown)) })
  }
  return (
    <div className="settings-row settings-row-indent" data-testid="remote-pairing">
      <div className="remote-pairing-line">
        <code className="remote-pairing-code" data-testid="remote-pairing-code">{code ?? '…'}</code>
        <button
          type="button"
          className="btn small"
          data-testid="remote-pairing-copy"
          disabled={code === null}
          onClick={() => { if (code !== null) void copyText(code).then((ok) => { setCopied(ok) }) }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className="btn small" data-testid="remote-pairing-new" onClick={renew}>New code</button>
      </div>
      <span className="settings-help">
        Enter it once on the other machine; it is remembered there. A new code makes every other
        machine enter it again.
      </span>
      {error !== null && <span className="settings-help remote-pairing-error" role="alert">{error}</span>}
    </div>
  )
}

function ConnectedClients({ patch }: { patch: Patch }): JSX.Element | null {
  const clients = useRemoteClients()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (clients.length === 0) return null
  const names = clients.map((c) => c.client).join(', ')
  const disconnect = (): void => {
    setConfirming(false)
    setError(null)
    disconnectAllRemote().then(
      () => { patch({ remoteAccess: false }) },
      (thrown: unknown) => { setError(remoteFailureText(thrown)) },
    )
  }
  return (
    <div className="settings-row settings-row-indent" data-testid="remote-clients">
      {clients.map((c) => (
        <span className="remote-client" key={c.id} data-testid="remote-client">
          Connected now: {c.client} (since {clockTime(c.connectedAt)})
        </span>
      ))}
      {confirming ? (
        <div className="remote-confirm" data-testid="remote-disconnect-confirm">
          <span className="settings-help">
            Disconnect {names} and turn remote access off? Turn it back on here to allow connections again.
          </span>
          <div className="remote-confirm-actions">
            <button type="button" className="btn small danger" data-testid="remote-disconnect-yes" onClick={disconnect}>Disconnect</button>
            <button type="button" className="btn small" data-testid="remote-disconnect-no" onClick={() => { setConfirming(false) }}>Keep</button>
          </div>
        </div>
      ) : (
        <div className="remote-confirm-actions">
          <button type="button" className="btn small" data-testid="remote-disconnect-all" onClick={() => { setConfirming(true) }}>Disconnect all…</button>
        </div>
      )}
      {error !== null && <span className="settings-help remote-pairing-error" role="alert">{error}</span>}
    </div>
  )
}

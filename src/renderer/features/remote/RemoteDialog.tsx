import { type JSX, useEffect, useState } from 'react'
import {
  isPairingCode, isRemoteHost, pairingError, pairingNotSaved, type RemoteHost, type RemoteHostSource, type RemoteHostState,
} from '@shared/domain/remote'
import { Modal } from '../../ui/Modal'
import { AlertIcon } from '../../ui/icons'
import { StartRemoteOffer, isUnreachableText, offerShows } from './StartRemoteOffer'
import { background } from '../../state/policy'
import { connectRemote, loadRemoteHosts, onRemoteHostsChanged, remoteFailureText } from '../../state/remote'

const SOURCE_TAGS: Record<RemoteHostSource, string> = { recent: 'recent', 'ssh-config': 'ssh config', tailscale: 'Tailscale' }

/** What a probe found, in words: a dot alone told nobody what grey meant. */
const STATUS_WORDS: Record<RemoteHostState, string> = {
  ready: 'ready', off: 'remote access off', refused: 'login refused', unreachable: 'unreachable', stopped: 'not running', unknown: 'checking…',
}

/** The work machine asked for its pairing code (or refused the one sent); `unsaved` when this computer cannot keep it. */
interface PairingAsk { host: string; wrong: boolean; unsaved: boolean }

/**
 * File → Open Remote Session → Other Host…: one field, the hosts used lately, and the reason a connection
 * failed in full (ssh's words are what someone needs to fix a key or a config line, so they are
 * wrapped, never cut). Main opens the remote window itself; this dialog only learns whether it worked.
 */
export function RemoteDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const [host, setHost] = useState('')
  const [hosts, setHosts] = useState<RemoteHost[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offer, setOffer] = useState<{ host: string; since: number } | null>(null)
  const [ask, setAsk] = useState<PairingAsk | null>(null)
  const [code, setCode] = useState('')

  const trimmed = host.trim()
  const hostOk = isRemoteHost(trimmed)
  const valid = hostOk && (ask === null || isPairingCode(code))
  const showHint = trimmed !== '' && !hostOk

  // Opening the dialog has main probe every listed host once; answers arrive as events.
  useEffect(() => {
    const unsubscribe = onRemoteHostsChanged(setHosts)
    background(loadRemoteHosts(true).then((list) => { if (list !== null) setHosts((now) => (now.length > list.length ? now : list)) }), 'remote')
    return unsubscribe
  }, [])

  const connect = (name: string = trimmed): void => {
    if (!isRemoteHost(name) || busy) return
    setHost(name)
    setError(null)
    setOffer(null)
    // A host known not to be running is offered a start instead of a connect that would fail.
    if (hosts.some((h) => h.name === name && h.status === 'stopped')) { setOffer({ host: name, since: 0 }); return }
    setBusy(true)
    // A code goes only to the machine that asked for it, and a different host starts over.
    const sent = ask !== null && ask.host === name && isPairingCode(code) ? code.trim() : undefined
    connectRemote(name, sent).then(
      onClose,
      (thrown: unknown) => {
        const text = remoteFailureText(thrown)
        const kind = pairingError(text)
        setBusy(false)
        if (kind === null) {
          setError(text)
          if (isUnreachableText(text)) setOffer({ host: name, since: Date.now() })
          return
        }
        setAsk({ host: name, wrong: kind === 'pairing-wrong', unsaved: pairingNotSaved(text) })
        setCode('')
      },
    )
  }

  // The offer replaces the "not accepting" error, which would otherwise contradict it (it says to
  // turn remote access on; the probe says Apiary is not even running).
  const offerShown = offer !== null && offerShows(offer.host, hosts, offer.since)

  return (
    <Modal testId="remote-dialog" titleId="remote-dialog-title" onClose={onClose} initialFocusSelector='[data-testid="remote-host"]'>
      <h2 id="remote-dialog-title">Connect to Remote Host</h2>
      <form className="remote-form" onSubmit={(e) => { e.preventDefault(); connect() }}>
        <label className="remote-label" htmlFor="remote-host">Host</label>
        <input
          id="remote-host"
          className="remote-input"
          data-testid="remote-host"
          value={host}
          disabled={busy}
          placeholder="work-box or user@work-box"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => { setHost(e.target.value); setAsk(null) }}
        />
        {showHint && (
          <p className="remote-hint" data-testid="remote-host-hint">Use a host name, an ~/.ssh/config alias or user@host.</p>
        )}
        {hosts.length > 0 && (
          <div className="remote-hosts" data-testid="remote-hosts">
            <span className="remote-label">Hosts</span>
            <div className="remote-host-list">
              {hosts.map((h) => (
                <button
                  key={h.name}
                  type="button"
                  className="remote-host-row"
                  data-testid="remote-host-row"
                  data-status={h.status}
                  title={h.detail}
                  disabled={busy}
                  onClick={() => { setHost(h.name); setAsk(null) }}
                  onDoubleClick={() => { connect(h.name) }}
                >
                  {h.status === 'unknown'
                    ? <span className="btn-spinner remote-host-dot" aria-label="checking" />
                    : <span className={`remote-host-dot ${h.status}`} aria-hidden="true" />}
                  <span className="remote-host-name" title={h.name}>{h.name}</span>
                  <span className="remote-host-source">{SOURCE_TAGS[h.source]}</span>
                  <span className="remote-host-status" data-testid="remote-host-status">{STATUS_WORDS[h.status]}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {ask !== null && <PairingField ask={ask} code={code} busy={busy} onCode={setCode} />}
        <p className="settings-help">
          Apiary connects over SSH with your keys and ~/.ssh/config, and opens that machine&apos;s window
          here. Turn on Settings → General → Allow remote access over SSH on that machine first.
        </p>
        {error !== null && !(offerShown && isUnreachableText(error)) && (
          <p className="remote-error" role="alert" data-testid="remote-error">
            <AlertIcon className="remote-error-icon" />
            <span>{error}</span>
          </p>
        )}
        {offer !== null && (
          <StartRemoteOffer
            host={offer.host} hosts={hosts} since={offer.since} disabled={busy}
            onWorking={setBusy} onStarted={onClose} onFailed={setError}
          />
        )}
        <div className="modal-actions">
          <button type="button" className="btn" data-testid="remote-cancel" disabled={busy} onClick={onClose}>Cancel</button>
          {/* With the start offer up, its button is the one obvious next step, not this one. */}
          <button type="submit" className={offerShown ? 'btn' : 'btn primary'} data-testid="remote-connect" disabled={!valid || busy}>
            {busy && <span className="btn-spinner" aria-hidden="true" />}
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

/** Shown once the work machine has asked for its pairing code (Settings → General there). */
function PairingField(
  { ask, code, busy, onCode }: { ask: PairingAsk; code: string; busy: boolean; onCode: (code: string) => void },
): JSX.Element {
  return (
    <div className="remote-pairing-field" data-testid="remote-pairing-field">
      <label className="remote-label" htmlFor="remote-pairing">Pairing code</label>
      <input
        id="remote-pairing"
        className="remote-input remote-pairing-input"
        data-testid="remote-pairing"
        value={code}
        disabled={busy}
        placeholder="XXXX-XXXX"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="characters"
        onChange={(e) => { onCode(e.target.value) }}
      />
      <p className="remote-hint" data-testid="remote-pairing-ask">
        {ask.wrong
          ? `That is not the pairing code ${ask.host} shows in its Settings → General.`
          : `${ask.host} asks for the pairing code shown in its Settings → General.`}
      </p>
      {ask.unsaved && (
        <p className="remote-hint" data-testid="remote-pairing-unsaved">
          This computer cannot keep the code safely, so you will enter it each time you connect.
        </p>
      )}
    </div>
  )
}

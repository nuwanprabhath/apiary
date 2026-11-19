import { type JSX, useEffect, useRef, useState } from 'react'
import type { SlackConfigChange, SlackStatus } from '@shared/domain/slack'
import { errorMessage } from '@shared/errors'
import { configureSlack, testSlack, useSlack } from '../../../state/slackStore'
import { ErrorBoundary } from '../../../ui/ErrorBoundary'
import { Switch } from '../../../ui/Switch'

const SETUP_DOC = 'https://github.com/nuwanprabhath/apiary/blob/main/docs/slack.md'

type Field = 'token' | 'channel' | 'ownerId' | 'enabled' | 'test'

function connectionSentence(s: SlackStatus): string {
  switch (s.connection) {
    case 'off': return 'Off.'
    case 'connecting': return 'Connecting…'
    case 'connected': return `Connected as @${s.bot?.name ?? 'bot'} in #${s.channel?.name ?? ''}.`
    case 'error': return s.error ?? 'Something went wrong.'
  }
}

function StatusLine({ status }: { status: SlackStatus }): JSX.Element {
  return (
    <div className="settings-row slack-status" data-testid="slack-status" data-connection={status.connection} role="status">
      <span className="slack-dot" data-connection={status.connection} aria-hidden="true" />
      <span className="slack-status-text">{connectionSentence(status)}</span>
    </div>
  )
}

/** A text field saved on Enter or blur, and only when it differs from what main has. */
function SavedField({ id, label, value, placeholder, hint, error, onSave }: {
  id: string
  label: string
  value: string
  placeholder: string
  hint: string
  error: string | undefined
  onSave: (text: string) => void
}): JSX.Element {
  const [text, setText] = useState(value)
  const sent = useRef(value)
  useEffect(() => { setText(value); sent.current = value }, [value])
  const save = (): void => {
    const next = text.trim()
    if (next === '' || next === sent.current) return
    sent.current = next
    onSave(next)
  }
  return (
    <div className="settings-row settings-row-stacked">
      <label className="settings-field-label" htmlFor={`slack-${id}`}>{label}</label>
      <input
        id={`slack-${id}`} className="search" data-testid={`slack-${id}`}
        value={text} placeholder={placeholder} spellCheck={false} autoComplete="off"
        onChange={(e) => { setText(e.target.value) }}
        onBlur={save}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
      />
      <span className="settings-help">{hint}</span>
      {error !== undefined && <span className="settings-help remote-pairing-error" role="alert" data-testid={`slack-${id}-error`}>{error}</span>}
    </div>
  )
}

function TokenRow({ status, error, onSave }: { status: SlackStatus; error: string | undefined; onSave: (token: string) => void }): JSX.Element {
  const [replacing, setReplacing] = useState(false)
  const [token, setToken] = useState('')
  const showField = !status.hasToken || replacing
  const save = (): void => {
    const t = token.trim()
    if (t === '') return
    setToken('')
    setReplacing(false)
    onSave(t)
  }
  return (
    <div className="settings-row settings-row-stacked">
      <label className="settings-field-label" htmlFor="slack-token">Bot token</label>
      {showField ? (
        <div className="account-add-line">
          <input
            id="slack-token" className="search account-add-input" data-testid="slack-token"
            type="password" autoComplete="off" spellCheck={false} placeholder="xoxb-…"
            disabled={!status.canStoreToken} value={token}
            onChange={(e) => { setToken(e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); save() } }}
          />
          <button className="btn primary" data-testid="slack-token-save" disabled={!status.canStoreToken || token.trim() === ''} onClick={save}>Save token</button>
          {replacing && <button className="btn" onClick={() => { setReplacing(false); setToken('') }}>Cancel</button>}
        </div>
      ) : (
        <div className="account-add-line">
          <span data-testid="slack-token-saved">A token is saved.</span>
          <button className="btn small" data-testid="slack-token-replace" onClick={() => { setReplacing(true) }}>Replace</button>
        </div>
      )}
      {!status.canStoreToken && (
        <span className="settings-help" data-testid="slack-no-keychain">This machine has no keychain, so Apiary cannot keep the token safely.</span>
      )}
      {error !== undefined && <span className="settings-help remote-pairing-error" role="alert" data-testid="slack-token-error">{error}</span>}
    </div>
  )
}

/**
 * Settings → Slack. Like Accounts, it is not part of the dialog's draft: each change goes to main
 * at once through `configureSlack`. The token is held only in the field until it is sent.
 */
export function SlackSection(): JSX.Element {
  const status = useSlack()
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  if (status === null) return <div data-testid="slack-section" />

  const run = (field: Field, work: Promise<void>): void => {
    setErrors((prev) => ({ ...prev, [field]: undefined }))
    work.catch((e: unknown) => { setErrors((prev) => ({ ...prev, [field]: errorMessage(e) })) })
  }
  const change = (field: Field, c: SlackConfigChange): void => { run(field, configureSlack(c)) }

  return (
    <ErrorBoundary compact label="Slack settings">
      <div data-testid="slack-section">
        <StatusLine status={status} />
        <div className="settings-row settings-row-stacked">
          <div className="resident-field resident-enabled">
            <strong>Take instructions from Slack</strong>
            <Switch checked={status.enabled} label="Take instructions from Slack" onChange={(enabled) => { change('enabled', { enabled }) }} />
          </div>
          <span className="settings-help">
            Regent carries out messages you post in this machine&apos;s channel, even when it is off duty. Apiary must be open.
          </span>
          {errors.enabled !== undefined && <span className="settings-help remote-pairing-error" role="alert">{errors.enabled}</span>}
        </div>
        <TokenRow status={status} error={errors.token} onSave={(token) => { change('token', { token }) }} />
        <SavedField
          id="channel" label="Channel" value={status.channel === null ? '' : `#${status.channel.name}`} placeholder="#work"
          hint="One channel per machine. Invite the bot there with /invite @regent."
          error={errors.channel} onSave={(channel) => { change('channel', { channel }) }}
        />
        <SavedField
          id="owner" label="Your Slack member id" value={status.ownerId ?? ''} placeholder="U0123ABCD"
          hint="Only your messages are carried out. In Slack: your profile, the ⋯ menu, Copy member ID."
          error={errors.ownerId} onSave={(ownerId) => { change('ownerId', { ownerId }) }}
        />
        <div className="settings-row settings-row-stacked">
          <div className="account-add-line">
            <button className="btn" data-testid="slack-test" onClick={() => { run('test', testSlack()) }}>Test connection</button>
            <button className="btn quiet small" data-testid="slack-setup-link" onClick={() => { window.open(SETUP_DOC, '_blank', 'noopener') }}>
              How to set up the Slack app
            </button>
          </div>
          {errors.test !== undefined && <span className="settings-help remote-pairing-error" role="alert">{errors.test}</span>}
        </div>
      </div>
    </ErrorBoundary>
  )
}

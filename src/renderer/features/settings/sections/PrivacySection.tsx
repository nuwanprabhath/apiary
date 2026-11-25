import { type JSX, useState } from 'react'
import type { AppSettingsPayload } from '@shared/api'
import { PRIVACY_FEATURES, PRIVACY_DISCLOSURES, type PrivacyFeature, type PrivacyStatus } from '@shared/domain/privacy'
import { ErrorBoundary } from '../../../ui/ErrorBoundary'
import { Switch } from '../../../ui/Switch'
import { focusAskedFor } from '../../../ui/focusUnlessTyping'
import { clampInt } from '../fields/NumberSetting'
import { saveInstantSetting } from '../../../state/settingsStore'
import { exportPrivacyData, grantPrivacy, revokePrivacy, setStrictMode, usePrivacy } from '../../../state/privacyStore'
import { Modal } from '../../../ui/Modal'
import { PrivacyConsentDialog } from './PrivacyConsentDialog'
import { PurgeDialog } from './PurgeDialog'

type Dialog =
  | { kind: 'all' }
  | { kind: 'one'; feature: PrivacyFeature }
  | { kind: 'withdraw'; feature: PrivacyFeature }
  | { kind: 'purge' }
  | null

const dateOf = (ms: number): string => new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

function stateLine(status: PrivacyStatus, feature: PrivacyFeature): string {
  if (!status.strict) return 'Allowed (privacy mode is off)'
  const consent = status.consents[feature]
  if (consent === undefined) return 'Not allowed'
  return consent.source === 'migrated' ? 'Allowed — you had this on before privacy mode' : `Allowed on ${dateOf(consent.grantedAt)}`
}

function WithdrawDialog({ feature, onCancel }: { feature: PrivacyFeature; onCancel: () => void }): JSX.Element {
  const [purge, setPurge] = useState(false)
  return (
    <ErrorBoundary label="This dialog">
      <Modal testId="privacy-withdraw-dialog" titleId="privacy-withdraw-title" onClose={onCancel}>
        <h2 id="privacy-withdraw-title">Withdraw {PRIVACY_DISCLOSURES[feature].label}?</h2>
        <p>Apiary stops sending this until you allow it again.</p>
        <label className="privacy-check">
          <input type="checkbox" data-testid="privacy-withdraw-purge" checked={purge} onChange={(e) => { setPurge(e.target.checked) }} />
          <span>Also delete what it produced</span>
        </label>
        <div className="modal-actions">
          <button className="btn" data-testid="privacy-withdraw-cancel" ref={focusAskedFor} onClick={onCancel}>Cancel</button>
          <button
            className="btn danger" data-testid="privacy-withdraw-confirm"
            onClick={() => { revokePrivacy(feature, purge); onCancel() }}
          >
            Withdraw
          </button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}

function Row({ testId, title, text, state, children }: {
  testId: string; title: string; text: string; state?: string; children?: JSX.Element | null
}): JSX.Element {
  return (
    <div className="settings-row privacy-row" data-testid={testId}>
      <span>
        <strong>{title}</strong>
        <span className="settings-help">{text}</span>
        {state !== undefined && <span className="settings-help privacy-state">{state}</span>}
      </span>
      {children}
    </div>
  )
}

/**
 * Settings → Privacy. Like Slack it saves at once through main (`privacyStore`), not through the
 * dialog's draft. `onOpenSection` jumps to the section a row's setting lives in.
 */
export function PrivacySection(
  { draft, machineHost, onOpenSection }: {
    draft: AppSettingsPayload
    machineHost: string | null
    onOpenSection: (id: string) => void
  },
): JSX.Element {
  const status = usePrivacy()
  const [dialog, setDialog] = useState<Dialog>(null)
  const [exported, setExported] = useState<string | null>(null)
  const close = (): void => { setDialog(null) }
  const notAllowed = PRIVACY_FEATURES.filter((f) => status.consents[f] === undefined)
  const usage = status.usageConsent === 'allowed' ? 'Allowed' : status.usageConsent === 'denied' ? 'Not allowed' : 'Not asked yet'

  return (
    <ErrorBoundary compact label="Privacy settings">
      <div data-testid="privacy-section">
        {machineHost !== null && (
          <p className="settings-help" data-testid="privacy-machine-hint">These are {machineHost}&apos;s privacy settings.</p>
        )}
        <div className="settings-row settings-row-stacked">
          <div className="resident-field resident-enabled">
            <strong>Privacy mode (recommended)</strong>
            <Switch
              checked={status.strict} label="Privacy mode (recommended)" testId="privacy-strict"
              onChange={(on) => { if (on) setStrictMode(true); else setDialog({ kind: 'all' }) }}
            />
          </div>
          <span className="settings-help">Nothing leaves this computer in the background until you allow it below.</span>
        </div>

        <h3 className="privacy-heading">What leaves this machine</h3>
        <div data-testid="privacy-recipients">
          {PRIVACY_FEATURES.map((f) => {
            const d = status.disclosures[f]
            const allowed = status.consents[f] !== undefined
            return (
              <Row key={f} testId={`privacy-row-${f}`} title={d.label} text={`Sends ${d.sends} to ${d.recipient}, ${d.when}.`} state={stateLine(status, f)}>
                {!status.strict ? null : allowed ? (
                  <button className="btn small" data-testid={`privacy-withdraw-${f}`} onClick={() => { setDialog({ kind: 'withdraw', feature: f }) }}>Withdraw</button>
                ) : (
                  <button className="btn small" data-testid={`privacy-allow-${f}`} onClick={() => { setDialog({ kind: 'one', feature: f }) }}>Allow…</button>
                )}
              </Row>
            )
          })}
          <Row testId="privacy-row-usage" title="Claude usage meter" text="Reads Claude Code's sign-in to ask Anthropic for your usage limits." state={usage}>
            <button className="btn quiet small" data-testid="privacy-open-plugins" onClick={() => { onOpenSection('plugins') }}>Plugins</button>
          </Row>
          <Row
            testId="privacy-row-updates" title="Update checks"
            text={`GitHub sees your IP address and Apiary version every ${String(draft.updateCheckIntervalHours)} hours.`}
            state={draft.updateAutomaticChecks ? 'On' : 'Off'}
          >
            <button className="btn quiet small" data-testid="privacy-open-updates" onClick={() => { onOpenSection('updates') }}>Updates</button>
          </Row>
          <Row testId="privacy-row-sessions" title="Your own Claude sessions" text="Sent to Anthropic when you send a message." />
        </div>

        <h3 className="privacy-heading">Keep Apiary&apos;s own data for</h3>
        <div className="settings-row settings-row-stacked">
          <label className="settings-inline">
            <input
              className="search settings-number" type="number" min={1} max={3650}
              data-testid="privacy-retention" value={status.retentionDays}
              onChange={(e) => { void saveInstantSetting({ dataRetentionDays: clampInt(e.target.value, 1, 3650) }) }}
            />
            <span>days</span>
          </label>
          <span className="settings-help">
            Digests, pasted images, scheduled-message logs, resident chats. Your Claude Code transcripts in ~/.claude follow Claude Code&apos;s own setting.
          </span>
        </div>

        <h3 className="privacy-heading">Your data</h3>
        <div className="settings-row settings-row-stacked">
          <div className="settings-inline">
            <button className="btn danger" data-testid="privacy-purge" onClick={() => { setDialog({ kind: 'purge' }) }}>Purge Apiary indexes, digests and logs…</button>
            <button
              className="btn" data-testid="privacy-export"
              onClick={() => { void exportPrivacyData().then(setExported) }}
            >
              Export my Apiary data…
            </button>
          </div>
          {exported !== null && <span className="settings-help settings-path" data-testid="privacy-export-path">Written to {exported}</span>}
        </div>

        {dialog?.kind === 'all' && (
          <PrivacyConsentDialog mode="all" features={notAllowed} onCancel={close} onConfirm={() => { setStrictMode(false); close() }} />
        )}
        {dialog?.kind === 'one' && (
          <PrivacyConsentDialog mode="one" features={[dialog.feature]} onCancel={close} onConfirm={() => { grantPrivacy(dialog.feature); close() }} />
        )}
        {dialog?.kind === 'withdraw' && <WithdrawDialog feature={dialog.feature} onCancel={close} />}
        {dialog?.kind === 'purge' && <PurgeDialog onClose={close} />}
      </div>
    </ErrorBoundary>
  )
}

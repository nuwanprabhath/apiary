import type { JSX } from 'react'
import { PRIVACY_DISCLOSURES, type PrivacyFeature } from '@shared/domain/privacy'
import { REGENT_KIND } from '@shared/domain/residents'
import { lookbackText } from '@shared/digestLookback'
import { useAppSettings } from '../../../state/settingsStore'
import { ErrorBoundary } from '../../../ui/ErrorBoundary'
import { Modal } from '../../../ui/Modal'
import { focusAskedFor } from '../../../ui/focusUnlessTyping'

/** Which sessions the background digest reads, from the resident that digests. */
function DigestScope(): JSX.Element {
  const lookback = useAppSettings().residents.find((r) => r.kind === REGENT_KIND)?.digestLookback ?? null
  return (
    <p className="settings-help" data-testid="privacy-digest-scope">
      {lookback === null ? 'This covers all sessions' : `This covers sessions from the last ${lookbackText(lookback)}`}; change it on Regent&apos;s card.
    </p>
  )
}

/** What one feature sends, to whom and when: `PRIVACY_DISCLOSURES` word for word. */
function Disclosure({ feature }: { feature: PrivacyFeature }): JSX.Element {
  const d = PRIVACY_DISCLOSURES[feature]
  return (
    <div className="privacy-disclosure" data-testid={`privacy-disclosure-${feature}`}>
      <strong>{d.label}</strong>
      <span className="settings-help">Recipient: {d.recipient}</span>
      <span className="settings-help">Sends: {d.sends}</span>
      <span className="settings-help">When: {d.when}</span>
    </div>
  )
}

/**
 * Allow one feature, or (`features` is every one not yet allowed) turn privacy mode off. Cancel is
 * the focused default so a stray Enter allows nothing.
 */
export function PrivacyConsentDialog(
  { mode, features, onCancel, onConfirm }: {
    mode: 'one' | 'all'
    features: readonly PrivacyFeature[]
    onCancel: () => void
    onConfirm: () => void
  },
): JSX.Element {
  const first = features[0]
  const title = mode === 'all' || first === undefined ? 'Turn off privacy mode?' : `Allow ${PRIVACY_DISCLOSURES[first].label}?`
  return (
    <ErrorBoundary label="This dialog">
      <Modal testId="privacy-consent-dialog" titleId="privacy-consent-title" onClose={onCancel}>
        <h2 id="privacy-consent-title">{title}</h2>
        {mode === 'all' && features.length > 0 && <p>These will send data in the background without asking again:</p>}
        <div className="privacy-disclosures">
          {features.map((f) => <Disclosure key={f} feature={f} />)}
        </div>
        {features.includes('backgroundDigest') && <DigestScope />}
        <div className="modal-actions">
          <button className="btn" data-testid="privacy-consent-cancel" ref={focusAskedFor} onClick={onCancel}>Cancel</button>
          <button className="btn primary" data-testid="privacy-consent-allow" onClick={onConfirm}>
            {mode === 'all' ? 'Turn off privacy mode' : 'Allow'}
          </button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}

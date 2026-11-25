import { type JSX, useState } from 'react'
import type { PurgeRequest, PurgeResult } from '@shared/domain/privacy'
import { ErrorBoundary } from '../../../ui/ErrorBoundary'
import { Modal } from '../../../ui/Modal'
import { focusAskedFor } from '../../../ui/focusUnlessTyping'
import { errorMessage } from '@shared/errors'
import { purgePrivacyData } from '../../../state/privacyStore'

const ITEMS: { key: keyof PurgeRequest; label: string }[] = [
  { key: 'searchIndex', label: 'Search index (rebuilt from your sessions)' },
  { key: 'digests', label: 'Topic digests' },
  { key: 'logs', label: 'Diagnostic logs' },
  { key: 'residentHistory', label: 'Resident chats and notes' },
  { key: 'slackMessages', label: 'Slack messages' },
  { key: 'pastedImages', label: 'Pasted images' },
  { key: 'scheduledLogs', label: 'Scheduled-message logs' },
  { key: 'sessionMetadata', label: 'Session names and notes' },
]

const DEFAULTS: PurgeRequest = {
  searchIndex: true, digests: true, logs: true, residentHistory: true,
  slackMessages: true, pastedImages: true, scheduledLogs: true, sessionMetadata: false,
}

function size(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} bytes`
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const labelOf = (key: keyof PurgeRequest): string => ITEMS.find((i) => i.key === key)?.label ?? key

/** Pick what to delete, confirm, then read what was freed and what could not be removed. */
export function PurgeDialog({ onClose, initialResult }: { onClose: () => void; initialResult?: PurgeResult }): JSX.Element {
  const [request, setRequest] = useState<PurgeRequest>(DEFAULTS)
  const [result, setResult] = useState<PurgeResult | null>(initialResult ?? null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const anyChecked = ITEMS.some((i) => request[i.key])

  const confirm = (): void => {
    setBusy(true)
    setError(null)
    purgePrivacyData(request).then(setResult).catch((e: unknown) => { setError(errorMessage(e)) }).finally(() => { setBusy(false) })
  }

  return (
    <ErrorBoundary label="This dialog">
      <Modal testId="privacy-purge-dialog" titleId="privacy-purge-title" onClose={onClose}>
        <h2 id="privacy-purge-title">Purge Apiary data</h2>
        {result === null ? (
          <>
            <div className="privacy-purge-items">
              {ITEMS.map((i) => (
                <label key={i.key} className="privacy-check">
                  <input
                    type="checkbox" data-testid={`privacy-purge-${i.key}`} checked={request[i.key]}
                    onChange={(e) => { setRequest((r) => ({ ...r, [i.key]: e.target.checked })) }}
                  />
                  <span>{i.label}</span>
                </label>
              ))}
            </div>
            <p className="settings-help">Your Claude Code transcripts in ~/.claude are not touched.</p>
            {error !== null && <p className="settings-help privacy-error" role="alert" data-testid="privacy-purge-error">{error}</p>}
            <div className="modal-actions">
              <button className="btn" data-testid="privacy-purge-cancel" ref={focusAskedFor} onClick={onClose}>Cancel</button>
              <button className="btn danger" data-testid="privacy-purge-confirm" disabled={!anyChecked || busy} onClick={confirm}>Purge</button>
            </div>
          </>
        ) : (
          <>
            <div data-testid="privacy-purge-result" role="status">
              <p>Freed {size(result.removedBytes)}.</p>
              {result.failed.length > 0 && (
                <ul className="privacy-failures">
                  {result.failed.map((f) => <li key={f.item}>{labelOf(f.item)}: {f.reason}</li>)}
                </ul>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn primary" data-testid="privacy-purge-done" ref={focusAskedFor} onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </Modal>
    </ErrorBoundary>
  )
}

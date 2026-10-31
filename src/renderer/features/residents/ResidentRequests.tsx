import type { JSX } from 'react'
import type { ResidentPermissionRequest } from '@shared/domain/residents'
import { answerPermission } from '../../state/residentChat'

/**
 * The tool uses the resident waits on, pinned above the composer, oldest first (main's order). Each
 * leaves when main drops it from `permissions` after the answer, not when the button is pressed.
 */
export function PermissionCards({ residentId, requests }: { residentId: string; requests: readonly ResidentPermissionRequest[] }): JSX.Element | null {
  if (requests.length === 0) return null
  return (
    <div className="resident-permissions" data-testid="resident-permissions">
      {requests.map((r) => (
        <div key={r.requestId} className="resident-permission" data-testid="resident-permission">
          <span className="resident-permission-text">
            <strong>{r.tool}</strong>
            <span className="resident-permission-summary" title={r.summary}>{r.summary}</span>
          </span>
          <button type="button" className="btn small" data-testid="resident-permission-deny" onClick={() => { answerPermission(residentId, r.requestId, false) }}>
            Deny
          </button>
          <button type="button" className="btn small primary" data-testid="resident-permission-allow" onClick={() => { answerPermission(residentId, r.requestId, true) }}>
            Allow
          </button>
        </div>
      ))}
    </div>
  )
}

/** Why the resident cannot run yet, at the top of the popup, with the way to fix it. */
export function SetupBanner({ text, onOpenSettings }: { text: string; onOpenSettings: () => void }): JSX.Element {
  return (
    <div className="resident-setup" data-testid="resident-setup" role="status">
      <span className="resident-setup-text">{text}</span>
      <button type="button" className="btn small" data-testid="resident-setup-open" onClick={onOpenSettings}>Open Settings</button>
    </div>
  )
}

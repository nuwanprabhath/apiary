import type { JSX } from 'react'
import type { UpdateStatusPayload } from '@shared/api'
import { remoteHost } from '../../state/windowParams'
import { UpdateBannerActions } from './UpdateBannerActions'
import { UpdateBannerBody } from './UpdateBannerBody'

/**
 * The strip that appears when there is an update, and at no other time.
 *
 * Deliberately not a modal: an update is never urgent enough to take the keyboard from someone
 * mid-sentence. It can be dismissed, and comes back at the next check unless the version was
 * skipped. What the buttons say depends on what this installation can do: an unsigned macOS build
 * cannot replace itself (see main/update/capability.ts). In a remote window the update is the work
 * machine's, and the banner names it.
 */
export function UpdateBanner(
  { status, onOpenSettings }: { status: UpdateStatusPayload; onOpenSettings: () => void },
): JSX.Element | null {
  const { phase, capability } = status
  const host = remoteHost()
  // 'up-to-date' and 'error' come from a check the user asked for, and are shown so that pressing
  // the menu item visibly does something; a silent scheduled check never reaches either.
  const shown = phase === 'available' || phase === 'downloading' || phase === 'ready'
    || phase === 'downloaded' || phase === 'up-to-date' || (phase === 'error' && status.error !== null)
    || phase === 'needs-password' || phase === 'installing' || phase === 'restarting'
  if (!shown) return null

  return (
    <div className="update-banner" data-testid="update-banner" data-phase={phase} role="status">
      <div className="update-banner-text">
        <UpdateBannerBody status={status} host={host} />
        {phase === 'available' && capability.kind === 'assisted' && status.installError === null && (
          // Said before the click: an unsigned build cannot install itself.
          <span className="update-banner-note">{capability.reason}</span>
        )}
        {phase === 'needs-password' && (
          <span className="update-banner-note" data-testid="update-password-note">
            {host === null ? 'Your password for sudo on this computer.' : `Your password on ${host}.`} Used once, never saved.
          </span>
        )}
      </div>

      {phase === 'downloading' && status.progressPercent !== null && (
        <div className="update-progress" data-testid="update-progress">
          <div className="update-progress-fill" style={{ width: `${String(status.progressPercent)}%` }} />
        </div>
      )}

      <UpdateBannerActions status={status} host={host} onOpenSettings={onOpenSettings} />
    </div>
  )
}

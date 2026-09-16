import type { UpdateStatusPayload } from '@shared/api'
import { CloseIcon } from './icons'
import { formatVersion } from '../state/updateSummary'
import { useNotifications } from '../state/notifications'

/**
 * The strip that appears when there is an update, and at no other time.
 *
 * Deliberately not a modal. An update is never urgent enough to take the keyboard away from
 * someone mid-sentence in a session, and a dialog that appears over the app every few hours is
 * how people learn to dismiss updates without reading them. It sits above the workspace, it can
 * be dismissed, and it comes back at the next check unless the version was skipped.
 *
 * What the buttons say depends on what this installation can actually do — an unsigned macOS
 * build cannot replace itself (see main/update/capability.ts), so it must not offer to.
 */
export function UpdateBanner(
  { status, onOpenSettings }: { status: UpdateStatusPayload; onOpenSettings: () => void },
): JSX.Element | null {
  const { notify } = useNotifications()
  const { phase, capability, availableVersion } = status
  // 'up-to-date' and 'error' come from a check the user asked for, and are shown so that pressing
  // the menu item visibly does something; a silent scheduled check never reaches either.
  const shown = phase === 'available' || phase === 'downloading' || phase === 'ready'
    || phase === 'downloaded' || phase === 'up-to-date' || (phase === 'error' && status.error !== null)
  if (!shown) return null

  const version = availableVersion === null ? '' : formatVersion(availableVersion)
  const assisted = capability.kind === 'assisted'

  const body = (): JSX.Element => {
    switch (phase) {
      case 'up-to-date':
        return <span>Apiary {formatVersion(status.currentVersion)} is the latest version.</span>
      case 'error':
        return <span>Could not check for updates — {status.error}</span>
      case 'downloading':
        return (
          <span>
            Downloading Apiary {version}…
            {status.progressPercent !== null && ` ${String(status.progressPercent)}%`}
          </span>
        )
      case 'ready':
        return <span>Apiary {version} is ready to install.</span>
      case 'downloaded':
        // The instruction comes from the main process, because it depends on what was downloaded
        // and where. This used to say "drag Apiary into Applications" on Ubuntu, beside a button
        // that could not open a .deb — an instruction for a thing that does not exist there.
        return (
          <span>
            Apiary {version} has been downloaded.{' '}
            {status.install?.hint ?? 'Open it to finish updating.'}
          </span>
        )
      default:
        return (
          <span>
            <strong>Apiary {version} is available.</strong> You are on{' '}
            {formatVersion(status.currentVersion)}.
          </span>
        )
    }
  }

  return (
    <div className="update-banner" data-testid="update-banner" data-phase={phase} role="status">
      <div className="update-banner-text">
        {body()}
        {phase === 'available' && assisted && (
          // Said before they click, not after: an unsigned build cannot install itself, and
          // finding that out at the end of a download is the thing this sentence prevents.
          <span className="update-banner-note">{capability.reason}</span>
        )}
      </div>

      {phase === 'downloading' && status.progressPercent !== null && (
        <div className="update-progress" data-testid="update-progress">
          <div className="update-progress-fill" style={{ width: `${String(status.progressPercent)}%` }} />
        </div>
      )}

      <div className="update-banner-actions">
        {phase === 'available' && (
          <>
            <button
              className="btn primary"
              data-testid="update-download"
              onClick={() => { void window.apiary.updateDownload() }}
            >
              {assisted ? 'Download' : 'Download and install'}
            </button>
            <button
              className="btn"
              data-testid="update-skip"
              title={`Stop offering ${version} — the next release is offered as normal`}
              onClick={() => { void window.apiary.updateSkip() }}
            >
              Skip this version
            </button>
          </>
        )}
        {phase === 'ready' && (
          <button
            className="btn primary"
            data-testid="update-install"
            onClick={() => { void window.apiary.updateInstall() }}
          >
            Restart and install
          </button>
        )}
        {phase === 'downloaded' && (
          <button
            className="btn primary"
            data-testid="update-open-downloaded"
            onClick={() => {
              // Caught rather than left to the global unhandled-rejection net, which would put
              // Electron's own words in front of the user — "reply was never sent" — and say
              // nothing about the file that is sitting on their disk, ready to install.
              void window.apiary.updateOpenDownloaded().catch(() => {
                notify({
                  kind: 'error',
                  message: status.downloadedPath === null
                    ? 'Could not hand the installer to your desktop.'
                    : `Could not hand the installer to your desktop. It is at ${status.downloadedPath}`,
                })
              })
            }}
          >
            {status.install?.action === 'reveal' ? 'Show in folder' : 'Open installer'}
          </button>
        )}
        {phase === 'downloaded' && status.install?.command != null && (
          // The command is the thing that actually finishes the update on a .deb, so it is a
          // button rather than a sentence to retype: nobody transcribes a path from a banner.
          <button
            className="btn"
            data-testid="update-copy-command"
            title={status.install.command}
            onClick={() => { void window.apiary.copyToClipboard(status.install?.command ?? '') }}
          >
            Copy install command
          </button>
        )}
        {status.releaseUrl !== null && phase !== 'up-to-date' && phase !== 'error' && (
          <button
            className="btn"
            data-testid="update-notes"
            onClick={() => { void window.apiary.copyToClipboard(status.releaseUrl ?? '') }}
            title="Copy the release page link"
          >
            Release notes
          </button>
        )}
        <button className="btn" data-testid="update-settings" onClick={onOpenSettings}>Update settings</button>
        <button
          className="update-banner-close"
          data-testid="update-dismiss"
          aria-label="Dismiss"
          title="Dismiss"
          onClick={() => { void window.apiary.updateDismiss() }}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  )
}

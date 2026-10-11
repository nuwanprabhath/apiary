import type { JSX } from 'react'
import type { UpdateStatusPayload } from '@shared/api'
import { CloseIcon } from '../../ui/icons'
import { formatVersion } from './updateSummary'
import { useNotifications } from '../../ui/notifications'
import { copyText } from '../../state/clipboard'
import { dismissUpdate, downloadUpdate, installUpdate, openDownloadedUpdate, skipUpdate } from '../../state/updateStore'

/** The buttons the banner offers for the current phase. */
export function UpdateBannerActions(
  { status, onOpenSettings }: { status: UpdateStatusPayload; onOpenSettings: () => void },
): JSX.Element {
  const { notify } = useNotifications()
  const { phase, capability, availableVersion } = status
  const version = availableVersion === null ? '' : formatVersion(availableVersion)
  const assisted = capability.kind === 'assisted'

  const handOver = (): void => {
    const failed = (): void => {
      notify({
        kind: 'error',
        message: status.downloadedPath === null
          ? 'Could not hand the installer to your desktop.'
          : `Could not hand the installer to your desktop. It is at ${status.downloadedPath}`,
      })
    }
    void openDownloadedUpdate()
      .then((result) => {
        if (result.ok === 'opened') return
        if (result.ok === 'revealed') {
          notify({
            kind: 'info',
            message: 'Showed the installer in your file manager — open it from there to finish.',
          })
          return
        }
        failed()
      })
      // Caught rather than left to the global unhandled-rejection net, which would put
      // Electron's own words in front of the user — "reply was never sent" — and say
      // nothing about the file that is sitting on their disk, ready to install.
      .catch(failed)
  }

  return (
    <div className="update-banner-actions">
      {phase === 'available' && (
        <>
          <button
            className="btn primary"
            data-testid="update-download"
            onClick={() => { downloadUpdate() }}
          >
            {assisted ? 'Download' : 'Download and install'}
          </button>
          <button
            className="btn"
            data-testid="update-skip"
            title={`Stop offering ${version} — the next release is offered as normal`}
            onClick={() => { skipUpdate() }}
          >
            Skip this version
          </button>
        </>
      )}
      {phase === 'ready' && (
        <button
          className="btn primary"
          data-testid="update-install"
          onClick={() => { installUpdate() }}
        >
          Restart and install
        </button>
      )}
      {phase === 'downloaded' && (
        <button className="btn primary" data-testid="update-open-downloaded" onClick={handOver}>
          {status.install?.action === 'reveal' ? 'Show in folder' : 'Open installer'}
        </button>
      )}
      {phase === 'downloaded' && status.install?.command !== null && status.install?.command !== undefined && (
        // The command is the thing that actually finishes the update on a .deb, so it is a
        // button rather than a sentence to retype: nobody transcribes a path from a banner.
        <button
          className="btn"
          data-testid="update-copy-command"
          title={status.install.command}
          onClick={() => { void copyText(status.install?.command ?? '') }}
        >
          Copy install command
        </button>
      )}
      {status.releaseUrl !== null && phase !== 'up-to-date' && phase !== 'error' && (
        <button
          className="btn"
          data-testid="update-notes"
          onClick={() => { void copyText(status.releaseUrl ?? '') }}
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
        onClick={() => { dismissUpdate() }}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

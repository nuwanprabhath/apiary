import type { JSX } from 'react'
import type { UpdateStatusPayload } from '@shared/api'
import { formatVersion } from './updateSummary'

/** The sentence the banner shows for the current phase. */
export function UpdateBannerBody({ status }: { status: UpdateStatusPayload }): JSX.Element | null {
  const { phase, availableVersion } = status
  const version = availableVersion === null ? '' : formatVersion(availableVersion)
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
    case 'available':
      return (
        <span>
          <strong>Apiary {version} is available.</strong> You are on{' '}
          {formatVersion(status.currentVersion)}.
        </span>
      )
    case 'checking':
    case 'idle':
      return null
  }
}

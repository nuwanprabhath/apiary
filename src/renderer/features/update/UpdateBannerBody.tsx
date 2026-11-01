import type { JSX } from 'react'
import type { UpdateStatusPayload } from '@shared/api'
import { formatVersion } from './updateSummary'

/**
 * The sentence the banner shows for the current phase. `host` is the work machine's name in a
 * remote window, whose banner is that machine's update; null in a local window.
 */
export function UpdateBannerBody({ status, host }: { status: UpdateStatusPayload; host: string | null }): JSX.Element | null {
  const { phase, availableVersion, installError } = status
  const version = availableVersion === null ? '' : formatVersion(availableVersion)
  const installing = <span>Installing Apiary {version}{host === null ? '' : ` on ${host}`}…</span>
  switch (phase) {
    case 'up-to-date':
      return <span>Apiary {formatVersion(status.currentVersion)} is the latest version.</span>
    case 'error':
      return <span>Could not check for updates — {status.error}</span>
    case 'downloading':
      if (status.installRequested) {
        return (
          <span>
            Installing Apiary {version}{host === null ? '' : ` on ${host}`}…
            {status.progressPercent !== null && ` ${String(status.progressPercent)}%`}
          </span>
        )
      }
      return (
        <span>
          Downloading Apiary {version}…
          {status.progressPercent !== null && ` ${String(status.progressPercent)}%`}
        </span>
      )
    case 'ready':
      return <span>Apiary {version} is ready to install.</span>
    case 'downloaded':
      if (installError !== null) {
        return (
          <span>
            <strong>Could not install {version}: {installError}</strong>{' '}
            {status.install?.hint ?? 'Open it to finish updating.'}
          </span>
        )
      }
      // Install and restart passes through here on its way to the password or the install.
      if (status.installRequested) return installing
      // The instruction comes from the main process, because it depends on what was downloaded
      // and where. This used to say "drag Apiary into Applications" on Ubuntu, beside a button
      // that could not open a .deb — an instruction for a thing that does not exist there.
      return (
        <span>
          Apiary {version} has been downloaded.{' '}
          {status.install?.hint ?? 'Open it to finish updating.'}
        </span>
      )
    case 'needs-password':
      return installError === null
        ? <strong>Apiary needs your password to install {version}</strong>
        : <strong>Could not install {version}: {installError}</strong>
    case 'installing':
      return installing
    case 'restarting':
      return <span>Restarting{host === null ? '' : ` ${host}`} into {version}…</span>
    case 'available':
      if (installError !== null) return <strong>Could not install {version}: {installError}</strong>
      return host === null
        ? (
          <span>
            <strong>Apiary {version} is available.</strong> You are on{' '}
            {formatVersion(status.currentVersion)}.
          </span>
        )
        : (
          <span>
            <strong>Update {host} to {version}</strong> It is on {formatVersion(status.currentVersion)}.
          </span>
        )
    case 'checking':
    case 'idle':
      return null
  }
}

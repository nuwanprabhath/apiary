import type { JSX } from 'react'
import { LinkIcon } from '../../ui/icons'

/** The title bar's chip in a remote window: which machine everything in it belongs to. */
export function RemoteBadge({ host }: { host: string }): JSX.Element {
  return (
    <span className="remote-badge" data-testid="remote-badge" title={`Connected to ${host} over SSH`}>
      <LinkIcon className="remote-badge-icon" />
      <span className="remote-badge-host">{host}</span>
    </span>
  )
}

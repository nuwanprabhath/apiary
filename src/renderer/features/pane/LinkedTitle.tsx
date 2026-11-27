import { type JSX, Fragment } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { MrState } from '@shared/domain/git'
import { findMentions } from '@shared/mentions/kinds'
import { openReferenceLink, useRepoWebLocation } from '../../state/mentions'
import { MrRefText } from '../../ui/mrRefText'

/**
 * A session title with its `!12` and `#34` references as links to the session's repository, as a
 * message's are, each MR keeping its state. Plain where main knows no repository page.
 */
export function LinkedTitle({ sessionId, title, statuses }: {
  sessionId: SessionId
  title: string
  statuses: Record<number, MrState | null>
}): JSX.Element {
  const repo = useRepoWebLocation(sessionId)
  const links = repo === null ? [] : findMentions(title, { repo, files: false })
  if (links.length === 0) return <MrRefText text={title} statuses={statuses} />
  const parts: JSX.Element[] = []
  let cursor = 0
  for (const [i, m] of links.entries()) {
    if (m.target.kind !== 'link') continue
    const href = m.target.href
    parts.push(<MrRefText key={`t${String(i)}`} text={title.slice(cursor, m.index)} statuses={statuses} />)
    parts.push(
      <a
        key={`l${String(i)}`} className="ref-link" data-testid="session-title-link" href={href} title={href}
        onClick={(e) => { e.preventDefault(); openReferenceLink(href) }}
      >
        <MrRefText text={m.text} statuses={statuses} />
      </a>,
    )
    cursor = m.index + m.text.length
  }
  parts.push(<Fragment key="tail"><MrRefText text={title.slice(cursor)} statuses={statuses} /></Fragment>)
  return <>{parts}</>
}

import type { JSX } from 'react'
import { formatMessageDateTime, formatMessageTime } from '@shared/time'

/** When a message was sent: a right-aligned line above the whole message, or (`inline`) floated right on the first line of a reply's text. */
export function MessageTime({ ms, inline = false }: { ms: number | null; inline?: boolean }): JSX.Element | null {
  if (ms === null) return null
  return (
    <time
      className={inline ? 'message-time message-time-inline' : 'message-time'}
      data-testid="message-time"
      dateTime={new Date(ms).toISOString()}
      title={formatMessageDateTime(ms)}
    >
      {formatMessageTime(ms)}
    </time>
  )
}

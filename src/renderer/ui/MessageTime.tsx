import type { JSX } from 'react'
import { formatMessageDateTime, formatMessageTime } from '@shared/time'

/** When a message was sent: a right-aligned line above the whole message. */
export function MessageTime({ ms }: { ms: number | null }): JSX.Element | null {
  if (ms === null) return null
  return (
    <time
      className="message-time"
      data-testid="message-time"
      dateTime={new Date(ms).toISOString()}
      title={formatMessageDateTime(ms)}
    >
      {formatMessageTime(ms)}
    </time>
  )
}

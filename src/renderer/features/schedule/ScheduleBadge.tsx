import type { JSX } from 'react'
import { ClockIcon } from '../../ui/icons'
import { useNextSchedule } from '../../state/scheduleStore'
import { useSecondsClock } from '../../state/secondsClock'
import { quoted, whenWords } from './scheduleTime'

/** A sidebar row's clock: the session has a scheduled message; its tooltip says which and when. */
export function ScheduleBadge({ sessionId }: { sessionId: string }): JSX.Element | null {
  const next = useNextSchedule(sessionId)
  if (next === null) return null
  return <Mark text={next.text} at={next.at} />
}

/** Its own component, so only a row that has a schedule reads the clock. */
function Mark({ text, at }: { text: string; at: number }): JSX.Element {
  const now = useSecondsClock()
  const label = `Scheduled: ${quoted(text)} at ${whenWords(at, now)}`
  return (
    <span className="session-schedule-mark" data-testid="session-schedule-mark" title={label} aria-label={label}>
      <ClockIcon />
    </span>
  )
}

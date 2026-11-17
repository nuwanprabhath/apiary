import { type JSX, useState } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { ScheduledMessage, ScheduleNotice } from '@shared/domain/schedule'
import { ContextMenu } from '../../ui/ContextMenu'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { AlertIcon, CheckIcon, ClockIcon, CloseIcon } from '../../ui/icons'
import { cancelSchedule, openScheduleDialog, sendScheduleNow, useSessionSchedules } from '../../state/scheduleStore'
import { useSecondsClock } from '../../state/secondsClock'
import { quoted, whenWords } from './scheduleTime'

function actionsFor(sessionId: SessionId, m: ScheduledMessage, prefix = ''): ContextMenuItem[] {
  return [
    { id: `${prefix}schedule-edit`, label: 'Edit…', run: () => { openScheduleDialog(sessionId, m) } },
    { id: `${prefix}schedule-send-now`, label: 'Send now', run: () => { sendScheduleNow(m.id) } },
    { id: `${prefix}schedule-cancel`, label: 'Cancel schedule', separator: true, run: () => { cancelSchedule(m.id) } },
  ]
}

/** What the chip says about one schedule. */
function chipText(m: ScheduledMessage, now: number): string {
  return m.missed === true ? `Missed: ${quoted(m.text)} was due ${whenWords(m.at, now)}` : `Sends ${quoted(m.text)} at ${whenWords(m.at, now)}`
}

function NoticeRow({ notice, now }: { notice: ScheduleNotice; now: number }): JSX.Element {
  const when = whenWords(notice.at, now)
  const text = notice.ok
    ? `Sent ${quoted(notice.text)} at ${when}${notice.whileClosed ? ' while Apiary was closed' : ''}`
    : `Could not send ${quoted(notice.text)} at ${when}${notice.detail === null ? '' : `: ${notice.detail.split('\n').at(-1) ?? ''}`}`
  return (
    <div className="schedule-notice" data-testid="schedule-notice" data-ok={notice.ok} role="status">
      {notice.ok ? <CheckIcon className="schedule-notice-icon" on /> : <AlertIcon className="schedule-notice-icon" />}
      <span className="schedule-notice-text" title={notice.detail === null ? text : `${text}\n\n${notice.detail}`}>{text}</span>
      <button className="icon-button quiet schedule-notice-dismiss" data-testid="schedule-notice-dismiss" aria-label="Dismiss" title="Dismiss" onClick={() => { cancelSchedule(notice.id) }}>
        <CloseIcon />
      </button>
    </div>
  )
}

/**
 * Above the message box: a chip for the session's scheduled messages ("Sends “continue” at 3:05 pm
 * today", or "2 scheduled messages"), whose menu edits, sends or cancels them, and a row for each
 * message sent unseen (by the OS job while Apiary was closed, or a send that failed).
 */
export function ScheduleBar({ sessionId }: { sessionId: SessionId }): JSX.Element | null {
  const schedules = useSessionSchedules(sessionId)
  if (schedules.messages.length === 0 && schedules.notices.length === 0) return null
  return <Bar sessionId={sessionId} {...schedules} />
}

/** Its own component, so a message box with nothing scheduled does not read the clock. */
function Bar({ sessionId, messages, notices, osJobs }: { sessionId: SessionId; messages: ScheduledMessage[]; notices: ScheduleNotice[]; osJobs: boolean }): JSX.Element {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)
  const now = useSecondsClock()
  const only = messages.length === 1 ? messages[0] : undefined
  const label = only !== undefined ? chipText(only, now) : `${String(messages.length)} scheduled messages`
  const items: ContextMenuItem[] = only !== undefined
    ? actionsFor(sessionId, only)
    : messages.map((m) => ({ id: `schedule-${m.id}`, label: chipText(m, now), submenu: actionsFor(sessionId, m, `${m.id}-`) }))
  return (
    <div className="schedule-bar" data-testid="schedule-bar">
      {notices.map((n) => <NoticeRow key={n.id} notice={n} now={now} />)}
      {messages.length > 0 && (
        <button
          className="btn small schedule-chip"
          data-testid="schedule-chip"
          data-missed={only?.missed === true}
          aria-haspopup="menu"
          title={osJobs ? label : `${label}. Sends only while Apiary is open.`}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            setMenuAt({ x: r.left, y: r.bottom + 2 })
          }}
        >
          <ClockIcon />
          <span className="schedule-chip-text">{label}</span>
        </button>
      )}
      <ContextMenu testId="schedule-menu" position={menuAt} items={items} onClose={() => { setMenuAt(null) }} />
    </div>
  )
}

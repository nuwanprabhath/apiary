import { type JSX, useEffect, useState } from 'react'
import { anHourFromNow, type ScheduleDefault } from '@shared/domain/schedule'
import { ErrorBoundary } from '../../ui/ErrorBoundary'
import { Modal } from '../../ui/Modal'
import { describeError } from '../../ui/errors'
import { focusAskedFor } from '../../ui/focusUnlessTyping'
import {
  cancelSchedule, saveSchedule, suggestScheduleTime, useSchedules, type ScheduleDialogRequest,
} from '../../state/scheduleStore'
import { useSecondsClock } from '../../state/secondsClock'
import { dateField, fromFields, timeField, tomorrowNine, whenWords } from './scheduleTime'

/** What an empty message sends: the word the field shows as its placeholder. */
const DEFAULT_MESSAGE = 'continue'

interface Props {
  request: ScheduleDialogRequest
  onClose: () => void
}

/** Where the suggested time came from, in the words the popup shows under the time. */
function sourceLine(suggested: ScheduleDefault | null, now: number): string {
  if (suggested === null) return 'Finding when your usage limit resets…'
  if (suggested.resetsAt !== null) return `Suggested: 5 min after your limit resets at ${whenWords(suggested.resetsAt, now)}`
  return 'No usage limit is known, so it suggests an hour from now'
}

/**
 * "Schedule a message…": the message, the date and time, quick picks and where the suggestion came
 * from. A new schedule starts at main's suggestion (5 minutes after the usage limit resets, when
 * that is known); an edit starts at the schedule's own time, and can delete it.
 */
export function ScheduleDialog({ request, onClose }: Props): JSX.Element {
  const editing = request.editing
  const [text, setText] = useState(editing?.text ?? '')
  const [date, setDate] = useState(() => (editing === null ? '' : dateField(editing.at)))
  const [time, setTime] = useState(() => (editing === null ? '' : timeField(editing.at)))
  const [suggested, setSuggested] = useState<ScheduleDefault | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { osJobs } = useSchedules()
  const now = useSecondsClock()

  useEffect(() => {
    let live = true
    suggestScheduleTime(request.sessionId).then((answer) => {
      if (!live) return
      setSuggested(answer)
      if (editing !== null) return
      setDate((cur) => (cur === '' ? dateField(answer.at) : cur))
      setTime((cur) => (cur === '' ? timeField(answer.at) : cur))
    }, () => {
      // With no suggestion the fields still start somewhere sensible.
      if (!live || editing !== null) return
      const at = anHourFromNow(Date.now())
      setSuggested({ at, source: 'hour', resetsAt: null })
      setDate(dateField(at)); setTime(timeField(at))
    })
    return () => { live = false }
  }, [request.sessionId, editing])

  const pick = (at: number): void => { setDate(dateField(at)); setTime(timeField(at)); setError(null) }
  const at = fromFields(date, time)

  const submit = async (): Promise<void> => {
    if (at === null) { setError('Pick a date and a time'); return }
    setSaving(true)
    try {
      await saveSchedule({ id: editing?.id ?? null, sessionId: request.sessionId, text: text.trim() === '' ? DEFAULT_MESSAGE : text, at })
      onClose()
    } catch (e) {
      setError(describeError(e).message)
      setSaving(false)
    }
  }

  return (
    <ErrorBoundary label="This dialog">
      <Modal testId="schedule-dialog" titleId="schedule-dialog-title" onClose={onClose} className="schedule-dialog" closeOnBackdropClick>
        <h2 id="schedule-dialog-title">{editing === null ? 'Schedule a message' : 'Edit scheduled message'}</h2>
        <label className="schedule-field-label" htmlFor="schedule-text">Message</label>
        <textarea
          id="schedule-text"
          ref={focusAskedFor}
          className="schedule-text"
          data-testid="schedule-text"
          value={text}
          placeholder={DEFAULT_MESSAGE}
          maxLength={10_000}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit() } }}
        />
        <p className="schedule-hint">Left empty, it sends “{DEFAULT_MESSAGE}”.</p>
        <span className="schedule-field-label">Send at</span>
        <div className="schedule-when">
          <input
            type="date" className="schedule-input" data-testid="schedule-date" aria-label="Date" value={date}
            onChange={(e) => { setDate(e.target.value); setError(null) }}
          />
          <input
            type="time" className="schedule-input" data-testid="schedule-time" aria-label="Time" value={time}
            onChange={(e) => { setTime(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }}
          />
        </div>
        <div className="schedule-chips" role="group" aria-label="Quick picks">
          {suggested?.resetsAt !== null && suggested !== null && (
            <button type="button" className="btn small" data-testid="schedule-pick-limit" onClick={() => { pick(suggested.at) }}>5 min after limit resets</button>
          )}
          <button type="button" className="btn small" data-testid="schedule-pick-hour" onClick={() => { pick(anHourFromNow(Date.now())) }}>In 1 hour</button>
          <button type="button" className="btn small" data-testid="schedule-pick-tomorrow" onClick={() => { pick(tomorrowNine(Date.now())) }}>Tomorrow 9:00</button>
        </div>
        {at !== null && <p className="schedule-when-summary" data-testid="schedule-summary">Sends {whenWords(at, now)}</p>}
        {editing === null && <p className="schedule-source" data-testid="schedule-source">{sourceLine(suggested, now)}</p>}
        {!osJobs && <p className="schedule-hint" data-testid="schedule-open-only">Sends only while Apiary is open.</p>}
        {error !== null && <p className="schedule-error" role="alert" data-testid="schedule-error">{error}</p>}
        <div className="modal-actions">
          {editing !== null && (
            <button
              type="button" className="btn schedule-delete" data-testid="schedule-delete"
              onClick={() => { cancelSchedule(editing.id); onClose() }}
            >
              Delete schedule
            </button>
          )}
          <span className="modal-actions-spacer" />
          <button type="button" className="btn" data-testid="schedule-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" data-testid="schedule-save" disabled={saving} onClick={() => { void submit() }}>
            {editing === null ? 'Schedule' : 'Save'}
          </button>
        </div>
      </Modal>
    </ErrorBoundary>
  )
}

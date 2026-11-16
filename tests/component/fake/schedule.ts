/**
 * Scheduled messages in the fake, modelled on `ScheduleService` (src/main/schedule): the text is
 * trimmed and must be 1–10 000 characters, the time in the next 30 days, the session known; a
 * replace names a schedule that exists; a cancel of an unknown id is a no-op, and dismisses a
 * notice; "Send now" takes the schedule off the list; every change tells every window with
 * `scheduleChanged`. The fake sends nothing on its own. `tests/contract/clauses/schedule.ts` pins it.
 */
import type { ApiaryApi } from '@shared/api'
import {
  SCHEDULE_MAX_AHEAD_MS, SCHEDULE_TEXT_MAX, anHourFromNow, type ScheduledMessage, type SchedulesState,
} from '@shared/domain/schedule'
import type { Env } from './state'

type ScheduleApi = Pick<ApiaryApi, 'scheduleList' | 'scheduleSet' | 'scheduleCancel' | 'scheduleSendNow' | 'scheduleDefault'>

export function scheduleApi(env: Env): ScheduleApi {
  const { state, emit } = env
  const view = (sessionId: string | null): SchedulesState => ({
    messages: state.schedules.messages.filter((m) => sessionId === null || m.sessionId === sessionId).sort((a, b) => a.at - b.at),
    notices: state.schedules.notices.filter((n) => sessionId === null || n.sessionId === sessionId),
    osJobs: state.schedules.osJobs,
  })
  const changed = (): void => { emit('scheduleChanged', view(null)) }
  return {
    scheduleList: async (sessionId) => view(sessionId),
    scheduleSet: async (request) => {
      const text = request.text.trim()
      const now = Date.now()
      if (text === '' || text.length > SCHEDULE_TEXT_MAX) throw new Error('Type the message to send')
      if (request.at <= now || request.at > now + SCHEDULE_MAX_AHEAD_MS) throw new Error('Pick a time in the next 30 days')
      if (request.id !== null && !state.schedules.messages.some((m) => m.id === request.id)) throw new Error('That schedule is gone')
      if (env.find(request.sessionId) === undefined) throw new Error(`Unknown session: ${request.sessionId}`)
      const message: ScheduledMessage = {
        id: request.id ?? crypto.randomUUID(), sessionId: request.sessionId, text, at: request.at, createdAt: now,
        account: state.sessionAccounts.get(request.sessionId) ?? state.accounts.defaultId,
      }
      state.schedules = { ...state.schedules, messages: [...state.schedules.messages.filter((m) => m.id !== message.id), message] }
      changed()
      return message
    },
    scheduleCancel: async (id) => {
      const before = state.schedules
      const next = { ...before, messages: before.messages.filter((m) => m.id !== id), notices: before.notices.filter((n) => n.id !== id) }
      if (next.messages.length === before.messages.length && next.notices.length === before.notices.length) return
      state.schedules = next
      changed()
    },
    scheduleSendNow: async (id) => {
      if (!state.schedules.messages.some((m) => m.id === id)) throw new Error('That schedule is gone')
      state.schedules = { ...state.schedules, messages: state.schedules.messages.filter((m) => m.id !== id) }
      state.scheduleSent.push(id)
      changed()
    },
    scheduleDefault: async (sessionId) => {
      if (env.find(sessionId) === undefined) return { at: anHourFromNow(Date.now()), source: 'hour', resetsAt: null }
      return state.scheduleDefault ?? { at: anHourFromNow(Date.now()), source: 'hour', resetsAt: null }
    },
  }
}

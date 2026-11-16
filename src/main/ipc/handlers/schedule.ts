import type { ScheduleService } from '../../schedule/scheduleService'
import type { Handlers } from '../registrar'

type HandledKeys = 'scheduleList' | 'scheduleSet' | 'scheduleCancel' | 'scheduleSendNow' | 'scheduleDefault'

/** The guards checked the shapes; the service checks the text, the time and the session, saves, and tells every window. */
export function scheduleHandlers(schedules: ScheduleService): Pick<Handlers, HandledKeys> {
  return {
    scheduleList: (_e, sessionId) => schedules.state(sessionId),
    scheduleSet: (_e, request) => schedules.set(request),
    scheduleCancel: (_e, id) => schedules.cancel(id),
    scheduleSendNow: (_e, id) => schedules.sendNow(id),
    scheduleDefault: (_e, sessionId) => schedules.defaultFor(sessionId),
  }
}

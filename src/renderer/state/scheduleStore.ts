import { useMemo } from 'react'
import type { SessionId } from '@shared/domain/ids'
import type { ScheduleDefault, ScheduledMessage, ScheduleNotice, ScheduleRequest, SchedulesState } from '@shared/domain/schedule'
import { createIpcStore } from './createIpcStore'
import { createLocalStore } from './createLocalStore'
import type { ContextMenuItem } from '../ui/contextMenuItem'
import { surface } from './policy'

/**
 * Scheduled messages (`shared/domain/schedule.ts`). Main owns them (`main/schedule/`) and sends
 * them, Apiary open or closed; every window hears `scheduleChanged` after a set, a cancel, a send
 * or a notice.
 */
const schedulesStore = createIpcStore<SchedulesState>({
  scope: 'schedule',
  initial: { messages: [], notices: [], osJobs: true },
  fetch: () => window.apiary.scheduleList(null),
  subscribe: (push) => window.apiary.onScheduleChanged(push),
})

/** Every schedule and notice. */
export function useSchedules(): SchedulesState {
  return schedulesStore.useStore()
}

export interface SessionSchedules {
  /** Soonest first. */
  messages: ScheduledMessage[]
  notices: ScheduleNotice[]
  osJobs: boolean
}

/** One session's schedules and notices. */
export function useSessionSchedules(sessionId: string): SessionSchedules {
  const all = schedulesStore.useStore()
  return useMemo(() => ({
    messages: all.messages.filter((m) => m.sessionId === sessionId).sort((a, b) => a.at - b.at),
    notices: all.notices.filter((n) => n.sessionId === sessionId),
    osJobs: all.osJobs,
  }), [all, sessionId])
}

/** The session's soonest schedule, for the sidebar row's clock; the same object until main sends a change. */
export function useNextSchedule(sessionId: string): ScheduledMessage | null {
  return schedulesStore.useStore((all) => {
    let soonest: ScheduledMessage | null = null
    for (const m of all.messages) if (m.sessionId === sessionId && (soonest === null || m.at < soonest.at)) soonest = m
    return soonest
  })
}

/** Creates or replaces a schedule. Returned: the popup shows main's refusal under its fields. */
export const saveSchedule = (request: ScheduleRequest): Promise<ScheduledMessage> => window.apiary.scheduleSet(request)

/** The suggested time for a session and where it came from. Returned: the popup waits on it. */
export const suggestScheduleTime = (sessionId: SessionId): Promise<ScheduleDefault> => window.apiary.scheduleDefault(sessionId)

/** Cancels a schedule, or dismisses a notice. */
export function cancelSchedule(id: string): void {
  surface(window.apiary.scheduleCancel(id), 'Could not cancel the scheduled message')
}

export function sendScheduleNow(id: string): void {
  surface(window.apiary.scheduleSendNow(id), 'Could not send the scheduled message')
}

/** The schedule popup this window shows: a new one for a session, or one being edited. */
export interface ScheduleDialogRequest {
  sessionId: SessionId
  /** The schedule being edited; null for a new one. */
  editing: ScheduledMessage | null
}

const dialog = createLocalStore<ScheduleDialogRequest | null>(null)

export function useScheduleDialog(): ScheduleDialogRequest | null {
  return dialog.useStore()
}

/** Opens the popup: from a menu's "Schedule a message…", or a chip's "Edit…". */
export function openScheduleDialog(sessionId: SessionId, editing: ScheduledMessage | null = null): void {
  dialog.set({ sessionId, editing })
}

export function closeScheduleDialog(): void {
  dialog.set(null)
}

/** "Schedule a message…" in a session's menus (the sidebar row's, the tab's); null `sessionId` for a session not started yet. */
export function scheduleMenuItem(sessionId: SessionId | null): ContextMenuItem {
  return {
    id: 'schedule-message',
    label: 'Schedule a message…',
    disabled: sessionId === null,
    disabledReason: 'Available once the session has started — send it a message first',
    run: () => { if (sessionId !== null) openScheduleDialog(sessionId) },
  }
}

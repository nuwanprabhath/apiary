import { isRecord } from '@shared/guards'
import { asSessionId } from '@shared/domain/ids'
import { isScheduleId, type ScheduledMessage, type ScheduleNotice } from '@shared/domain/schedule'
import { JsonStore } from '../fs/jsonStore'

/** `scheduled-messages.json`: what is waiting to be sent, and what was sent unseen. */
export interface ScheduleFile {
  messages: ScheduledMessage[]
  notices: ScheduleNotice[]
}

const isText = (v: unknown): v is string => typeof v === 'string'
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function parseMessage(v: unknown): ScheduledMessage | null {
  if (!isRecord(v) || !isScheduleId(v.id) || !isText(v.sessionId) || !isText(v.text) || !finite(v.at) || !finite(v.createdAt)) return null
  return {
    id: v.id, sessionId: asSessionId(v.sessionId), text: v.text, at: v.at, createdAt: v.createdAt,
    ...(isText(v.account) ? { account: v.account } : {}),
    ...(v.missed === true ? { missed: true } : {}),
  }
}

function parseNotice(v: unknown): ScheduleNotice | null {
  if (!isRecord(v) || !isScheduleId(v.id) || !isText(v.sessionId) || !isText(v.text) || !finite(v.at) || typeof v.ok !== 'boolean') return null
  return {
    id: v.id, sessionId: asSessionId(v.sessionId), text: v.text, at: v.at, ok: v.ok,
    whileClosed: v.whileClosed === true, detail: isText(v.detail) ? v.detail : null,
  }
}

const parseList = <T>(raw: unknown, parse: (v: unknown) => T | null): T[] =>
  (Array.isArray(raw) ? raw.map(parse).filter((x): x is T => x !== null) : [])

export function createScheduleStore(file: string): JsonStore<ScheduleFile> {
  return new JsonStore<ScheduleFile>({
    file,
    version: 1,
    // It holds the messages people typed.
    private: true,
    parse: (raw) => (isRecord(raw)
      ? { messages: parseList(raw.messages, parseMessage), notices: parseList(raw.notices, parseNotice) }
      : { messages: [], notices: [] }),
    fallback: () => ({ messages: [], notices: [] }),
  })
}

import type { SessionId } from '@shared/domain/ids'
import { errorMessage } from '@shared/errors'
import { createLocalStore } from './createLocalStore'
import { readAsideThread, writeAsideThread } from './uiState'

/** One side question (`/btw`) of a thread, and where its answer is. */
export interface AsideTurn {
  question: string
  status: 'asking' | 'answered' | 'failed'
  answer: string | null
  error: string | null
  /** When it was asked: it names the turn an answer arriving later belongs to. */
  askedAt: number
}

/** A session's side-question thread, and whether its card is out. */
export interface AsideThread {
  turns: readonly AsideTurn[]
  open: boolean
}

/** This window's threads, by session, read from `uiState` the first time a session's is opened. */
const threads = createLocalStore<Readonly<Record<string, AsideThread>>>({})

/** The question of a `/btw` message: '' for `/btw` alone, null for any other message. */
export function asideQuestion(text: string): string | null {
  const m = /^\/btw(?:\s+([\s\S]*))?$/.exec(text.trim())
  return m === null ? null : (m[1] ?? '').trim()
}

export function useAsideThread(sessionId: SessionId): AsideThread | null {
  return threads.useStore((all) => all[sessionId] ?? null)
}

/** The session's thread as it is now, read from storage when this window has not loaded it yet. */
function current(sessionId: SessionId): AsideThread {
  const loaded = threads.get()[sessionId]
  if (loaded !== undefined) return loaded
  const turns = readAsideThread(sessionId).map((t, i): AsideTurn => ({
    question: t.question, answer: t.answer, error: t.error, status: t.error === null ? 'answered' : 'failed', askedAt: i,
  }))
  return { turns, open: false }
}

/** Sets the session's thread, keeping its finished exchanges in storage. */
function put(sessionId: SessionId, thread: AsideThread): void {
  threads.set((all) => ({ ...all, [sessionId]: thread }))
  writeAsideThread(sessionId, thread.turns.filter((t) => t.status !== 'asking')
    .map((t) => ({ question: t.question, answer: t.answer, error: t.error })))
}

/** `/btw` alone: the card, with whatever the thread holds. */
export function openAside(sessionId: SessionId): void {
  put(sessionId, { ...current(sessionId), open: true })
}

/**
 * Asks a side question in the session's thread (`chatAside`), opening its card: answered apart
 * from the conversation, which goes on untouched, mid-turn included. The thread's earlier answers go
 * with it, so a follow-up can build on them.
 */
export function askAside(sessionId: SessionId, question: string): void {
  const thread = current(sessionId)
  const earlier = thread.turns.flatMap((t) => (t.status === 'answered' && t.answer !== null ? [{ question: t.question, answer: t.answer }] : []))
  const askedAt = Date.now()
  put(sessionId, { open: true, turns: [...thread.turns, { question, status: 'asking', answer: null, error: null, askedAt }] })
  const settle = (patch: Partial<AsideTurn>): void => {
    const now = threads.get()[sessionId]
    if (now === undefined || !now.turns.some((t) => t.askedAt === askedAt)) return
    put(sessionId, { ...now, turns: now.turns.map((t) => (t.askedAt === askedAt ? { ...t, ...patch } : t)) })
  }
  window.apiary.chatAside(sessionId, question, earlier).then(
    (answer) => { settle({ status: 'answered', answer }) },
    (error: unknown) => { settle({ status: 'failed', error: errorMessage(error) }) },
  )
}

/** Puts the card away; the thread stays, for the next `/btw`. */
export function closeAside(sessionId: SessionId): void {
  const thread = threads.get()[sessionId]
  if (thread !== undefined) threads.set((all) => ({ ...all, [sessionId]: { ...thread, open: false } }))
}

/** Forgets the thread: the card stays out, empty. */
export function clearAside(sessionId: SessionId): void {
  put(sessionId, { turns: [], open: true })
}

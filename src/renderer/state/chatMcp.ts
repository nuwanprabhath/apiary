import type { SessionId } from '@shared/domain/ids'
import type { McpAnswer, McpRequest } from '@shared/domain/mcp'
import { errorMessage } from '@shared/errors'
import { createLocalStore } from './createLocalStore'

/**
 * A session's MCP card (`/mcp` in a chat): Claude Code's `/mcp` dialog, which stream-json mode
 * cannot draw, as a card over the message box that reads and drives the chat's servers (`chatMcp`).
 */
export interface McpCard {
  open: boolean
  /** The servers as last read; null before the first answer. */
  answer: McpAnswer | null
  /** Reading the servers. */
  reading: boolean
  /** The server an action is running on. */
  working: string | null
  /** What went wrong last, in claude's words. */
  error: string | null
  /** Why there is no chat to ask (Claude is busy in the session's terminal); nothing else shows. */
  unavailable: string | null
}

const CLOSED: McpCard = { open: false, answer: null, reading: false, working: null, error: null, unavailable: null }
const cards = createLocalStore<Readonly<Record<string, McpCard>>>({})

const card = (sessionId: SessionId): McpCard => cards.get()[sessionId] ?? CLOSED
const putCard = (sessionId: SessionId, patch: Partial<McpCard>): void => {
  cards.set((all) => ({ ...all, [sessionId]: { ...(all[sessionId] ?? CLOSED), ...patch } }))
}

/** `/mcp` alone, as typed or chosen from the "/" menu. */
export function isMcpCommand(text: string): boolean {
  return /^\/mcp$/.test(text.trim())
}

export function useMcpCard(sessionId: SessionId): McpCard {
  return cards.useStore((all) => all[sessionId] ?? CLOSED)
}

/** Runs one request on the session's chat and keeps the servers it answers with. */
async function askChat(sessionId: SessionId, request: McpRequest): Promise<void> {
  const idle = { reading: false, working: null }
  putCard(sessionId, { reading: request.kind === 'status', working: request.kind === 'status' ? null : request.server, error: null })
  try {
    const answer = await window.apiary.chatMcp(sessionId, request)
    // A sign-in stays on the card until it is done or another starts.
    const signIn = answer.signIn ?? (request.kind === 'status' || request.kind === 'reconnect' ? card(sessionId).answer?.signIn ?? null : null)
    const done = signIn !== null && answer.servers.some((s) => s.name === signIn.server && s.status === 'connected')
    putCard(sessionId, { answer: { servers: answer.servers, signIn: done ? null : signIn }, ...idle })
  } catch (e) {
    putCard(sessionId, { ...idle, error: errorMessage(e) })
  }
}

/**
 * Opens the card and reads the servers. `prepare` makes sure the session runs as a chat (starting
 * one, taking over an idle terminal) and says why not when it cannot.
 */
export async function openMcp(sessionId: SessionId, prepare: () => Promise<string | null>): Promise<void> {
  putCard(sessionId, { open: true, reading: true, error: null, unavailable: null })
  let why: string | null
  try {
    why = await prepare()
  } catch (e) {
    putCard(sessionId, { reading: false, error: errorMessage(e) })
    return
  }
  if (why !== null) { putCard(sessionId, { reading: false, unavailable: why }); return }
  await askChat(sessionId, { kind: 'status' })
}

export function refreshMcp(sessionId: SessionId): Promise<void> {
  return askChat(sessionId, { kind: 'status' })
}

/** Toggles, reconnects, signs in or out: the servers come back as they are after it. */
export function runMcp(sessionId: SessionId, request: Exclude<McpRequest, { kind: 'status' }>): Promise<void> {
  return askChat(sessionId, request)
}

/** Puts the card away; it reads the servers afresh when it opens again. */
export function closeMcp(sessionId: SessionId): void {
  putCard(sessionId, { open: false, error: null, unavailable: null })
}

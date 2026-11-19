import type { SlackMessage } from './slackApi'

export const STALE_MS = 15 * 60_000
export const AWAITING_MS = 24 * 60 * 60_000
const BUSY_POLL_MS = 3_000
const IDLE_POLL_MS = 10_000
export const FAILURE_POLL_MS = 60_000
const RECENT_MS = 5 * 60_000
export const DEEP_POLL_MS = 30_000

/** A Slack `ts` ("1763540000.000100") compared as a number; negative when `a` is older. */
export function compareTs(a: string, b: string): number {
  const [ai = '0', af = ''] = a.split('.')
  const [bi = '0', bf = ''] = b.split('.')
  if (ai.length !== bi.length) return ai.length - bi.length
  if (ai !== bi) return ai < bi ? -1 : 1
  const width = Math.max(af.length, bf.length)
  const x = af.padEnd(width, '0')
  const y = bf.padEnd(width, '0')
  return x === y ? 0 : x < y ? -1 : 1
}

export const tsToMs = (ts: string): number => Math.floor(Number(ts) * 1000)

export function msToTs(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  return `${String(seconds)}.${String(Math.floor(ms % 1000) * 1000).padStart(6, '0')}`
}

/** Only the owner's own plain messages are instructions: no bots, no edits, joins or other subtypes. */
export function isOwnerMessage(message: SlackMessage, ownerId: string | null): boolean {
  return ownerId !== null && message.user === ownerId && message.botId === null && message.subtype === null
}

export type Answer = { kind: 'yes' } | { kind: 'no' } | { kind: 'other'; text: string }

const YES = new Set(['yes', 'y', 'ok', 'do it'])

/** What the owner's reply to "Still want it?" means; case and punctuation are ignored. */
export function readAnswer(text: string): Answer {
  const plain = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim()
  if (YES.has(plain)) return { kind: 'yes' }
  if (plain === 'no' || plain === 'n') return { kind: 'no' }
  return { kind: 'other', text }
}

/** How long to wait before the next cycle. */
export function nextDelay(o: { openTask: boolean; lastActivityAt: number; now: number }): number {
  return o.openTask || o.now - o.lastActivityAt < RECENT_MS ? BUSY_POLL_MS : IDLE_POLL_MS
}

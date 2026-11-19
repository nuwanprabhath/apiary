/**
 * Another Claude session's message, as Claude Code 2.1.328 writes it: a plain `user` entry whose text
 * is `Another Claude session sent a message:`, then `<teammate-message teammate_id="…" …>` around
 * the sender's words, then a paragraph telling Claude how to treat a peer. Earlier builds (2.1.302)
 * put the sender in an `origin` field instead, which `transcriptReader.ts` reads first.
 *
 * Returns the sender's id and its own words, or null for any other text.
 */
const FRAME = /^\s*Another Claude session sent a message:\s*<teammate-message\b([^>]*)>([\s\S]*?)<\/teammate-message>/
const TEAMMATE_ID = /\bteammate_id="([^"]*)"/

export function teammateMessage(text: string): { from: string | null; text: string } | null {
  const match = FRAME.exec(text)
  if (match === null) return null
  const body = (match[2] ?? '').trim()
  if (body === '') return null
  const id = TEAMMATE_ID.exec(match[1] ?? '')?.[1] ?? ''
  return { from: id === '' ? null : id, text: body }
}

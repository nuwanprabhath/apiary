/**
 * Pty and tab id conventions, minted in main and parsed in the renderer (and vice versa). A shell
 * keyed under the wrong id looks like nothing is running, or kills a live process.
 *
 * The ids are persisted in `session-layout.json`, so their format cannot change. The branded types
 * live in `ids.ts`; the helpers here mint and parse `PtyId`s.
 */

import { asPtyId, type PtyId } from './ids'

/** A pty for a session that has no real session id yet (a brand-new or forked session, before
 *  Claude's JSONL exists). Minted once per new pty; never reused. */
export function newPendingPtyId(uuid: string): PtyId {
  return asPtyId(`new:${uuid}`)
}

export function isPendingPtyId(id: string): boolean {
  return id.startsWith('new:')
}

/** The pty id of a shell tab under `owner` (a session id or a pending pty id), numbered `terminalId`. */
export function shellPtyId(owner: string, terminalId: string | number): PtyId {
  return asPtyId(`shell:${owner}:${String(terminalId)}`)
}

/**
 * Splits a `shell:<owner>:<terminalId>` id back into its parts, or null if `id` is not one. The
 * owner may itself contain a colon, so only the *last* segment is the terminal id.
 */
export function parseShellPtyId(id: string): { owner: string; terminalId: string } | null {
  const match = /^shell:(.+):([^:]+)$/.exec(id)
  return match === null ? null : { owner: match[1], terminalId: match[2] }
}

/**
 * Branded identifier types. At runtime these are plain strings — over IPC, in `session-layout.json`, in SQLite — the brand exists only for the compiler,
 * so a session id cannot be passed where a pty id is wanted, nor a bare string where either is.
 *
 * Brand at the boundaries, not at the use sites: ids are *minted* (`newPendingPtyId`,
 * `shellPtyId`, a session row read from the store), *parsed* (`parseShellPtyId`) or *received*
 * from IPC (the `sessionIdArg`/`ptyIdArg`/`terminalRefArg` guards in `shared/ipc/contract.ts`).
 * Everything past one of those carries the brand and needs no cast.
 */

declare const brand: unique symbol

/** True for a whole string that is a session id (a UUID); main validates before an id reaches a shell. */
export const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
/** The same shape unanchored, so a pattern can embed it (`--resume <id>`). */
export const UUID_PATTERN = UUID_RE.source.slice(1, -1)

/** A Claude session's id (a UUID), as the sidebar, the store and the transcript know it. */
export type SessionId = string & { readonly [brand]: 'SessionId' }

/** The id a pty is known by: `new:<uuid>` for a not-yet-real session, `shell:<owner>:<n>` for a
 *  shell tab, and a session's own id for the pty running that session. */
export type PtyId = string & { readonly [brand]: 'PtyId' }

/** A Claude account (`shared/domain/accounts.ts`): `main`, or the slug of an added account's label. */
export type AccountId = string & { readonly [brand]: 'AccountId' }

/** Boundary conversions, for where an id is minted or arrives from outside the typed world. */
export function asSessionId(id: string): SessionId {
  return id as SessionId
}
export function asPtyId(id: string): PtyId {
  return id as PtyId
}
export function asAccountId(id: string): AccountId {
  return id as AccountId
}

export function ptyIdOfSession(id: SessionId): PtyId {
  return asPtyId(id)
}

/**
 * Names the terminal a cwd-carrying call is about: a stored session (resolved through the store)
 * or a pty with no stored session yet (resolved through the pty manager).
 */
export type TerminalRef =
  | { kind: 'session'; id: SessionId }
  | { kind: 'pty'; id: PtyId }

/** Builds a `TerminalRef` from a bare key and the flag that says which it is — for callers that
 *  still hold the pair (a tab key plus `isPtyKey(tab)`). */
export function terminalRef(key: string, isPtyId: boolean): TerminalRef {
  return isPtyId ? { kind: 'pty', id: asPtyId(key) } : { kind: 'session', id: asSessionId(key) }
}

export function isTerminalRef(v: unknown): v is TerminalRef {
  if (typeof v !== 'object' || v === null) return false
  const r = v as { kind?: unknown; id?: unknown }
  return (r.kind === 'session' || r.kind === 'pty') && typeof r.id === 'string'
}

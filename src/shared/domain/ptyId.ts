/**
 * Pty and tab id conventions, minted in main and parsed in the renderer (and vice versa) — a
 * cross-process protocol that used to be built independently on both sides (MAIN-21, UI-17,
 * SHARED-3's pty-id part). A mismatch here is exactly the bug class CLAUDE.md's "Windows, and what
 * belongs to which" section describes: a shell keyed under the wrong id looks like nothing is
 * running, or — the incident that section records — kills a live process out from under a build.
 *
 * This is deliberately the small, safe half of MAIN-21: the mint/parse helpers, unifying eight call
 * sites into one definition each, with no behaviour change (ids are byte-identical to before,
 * since `session-layout.json` on disk already contains them). The larger step MAIN-21 also
 * describes — branded `SessionId`/`PtyId` types and replacing the 17 `(key, isPtyId)` `ApiaryApi`
 * parameter pairs with one `TerminalRef` — depends on the IPC registrar work (MAIN-11) and is not
 * done here.
 */

/** A pty for a session that has no real session id yet (a brand-new or forked session, before
 *  Claude's JSONL exists). Minted once per new pty; never reused. */
export function newPendingPtyId(uuid: string): string {
  return `new:${uuid}`
}

/** Whether `id` is a pending pty id rather than a real session id. */
export function isPendingPtyId(id: string): boolean {
  return id.startsWith('new:')
}

/** The pty id of a shell tab under `owner` (a session id or a pending pty id), numbered `terminalId`. */
export function shellPtyId(owner: string, terminalId: string | number): string {
  return `shell:${owner}:${String(terminalId)}`
}

/**
 * Splits a `shell:<owner>:<terminalId>` id back into its parts, or null if `id` is not one.
 *
 * The owner group is greedy: `owner` can itself contain a colon (a pending id's uuid never does,
 * but this stays correct regardless), so only the *last* colon-separated segment is taken as the
 * terminal id.
 */
export function parseShellPtyId(id: string): { owner: string; terminalId: string } | null {
  const match = /^shell:(.+):([^:]+)$/.exec(id)
  return match === null ? null : { owner: match[1], terminalId: match[2] }
}

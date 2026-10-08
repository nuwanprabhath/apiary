import { asPtyId, asSessionId, type PtyId, type SessionId } from '@shared/domain/ids'

/**
 * The id every pty for a tab hangs off — see `useSessionKeys`. Pure, so the selector in
 * `pane/usePaneWorkspace` and the hook agree on it.
 *
 * This is where a bare tab key becomes a `PtyId`: tab keys are plain strings (a session id or a
 * pending `new:<uuid>` pty id, whichever the tab was opened under), and a session's pty is keyed
 * by its own id, so the key itself is the id unless the session was started under another pty
 * (`ptyOverrides`).
 */
export function ptyKeyOf(
  pending: { has: (key: string) => boolean },
  ptyOverrides: { get: (key: string) => PtyId | undefined },
  tabKey: string,
): PtyId {
  return pending.has(tabKey) ? asPtyId(tabKey) : ptyOverrides.get(tabKey) ?? asPtyId(tabKey)
}

/**
 * The session a tab shows, for a command that acts on the session (fork). A tab key is a session
 * id once the session exists — a pending tab's key is a pty id, which the tab bar disables the
 * session commands for — so this is the one place the bare key is read as a `SessionId`.
 */
export function sessionIdOfTabKey(tabKey: string): SessionId {
  return asSessionId(tabKey)
}

import { createHash } from 'node:crypto'
import type { TerminalRef } from '@shared/domain/ids'
import { IPC, type IpcKey } from '@shared/ipc/contract'
import type { RefusalReason } from '@shared/domain/remote'

/**
 * The messages between a home machine (the client) and a work machine's Apiary (the server), sent
 * as frames (`frames.ts`) over the work machine's Unix socket, which the client reaches through
 * SSH's socket forwarding. See docs/proposals/2026-10-10-remote-access.md.
 *
 * One connection carries any number of remote windows (`w`, a number the client chose). A call
 * names its contract key, never a channel string, and the server checks the key's scope
 * (`scopes.ts`) and the contract's own argument guard before any handler runs.
 */

/** Bumped when these messages change shape; part of the handshake beside the contract's hash. */
export const PROTOCOL_VERSION = 2

export type ClientMessage =
  | {
    t: 'hello'; protocol: number; contract: string; appVersion: string
    /** The home machine's name (`os.hostname()`). Informational: shown in the work machine's list, never trusted. */
    client?: string
    /** The pairing code, when the work machine asks for one. Never logged. */
    pairing?: string
  }
  /** Opens remote window `w` on the server: from then on its calls and events flow. */
  | { t: 'open'; w: number }
  | { t: 'close'; w: number }
  | { t: 'invoke'; id: number; w: number; key: IpcKey; args: unknown[] }
  | { t: 'send'; w: number; key: IpcKey; args: unknown[] }
  /** The server's windows and their layouts, to seed the client's copies. */
  | { t: 'layouts'; id: number }
  /** Where a session's folder, or a file a transcript mentions, is on the server. Launches nothing. */
  | ({ t: 'resolve'; id: number; w: number } & ResolveRequest)

/** What the client wants resolved; the server checks `terminal` and `mention` with the contract's own guards. */
export type ResolveRequest =
  | { what: 'session-folder'; terminal: TerminalRef }
  | { what: 'mentioned-file'; terminal: TerminalRef; mention: string }

export interface Resolved { path: string; line?: number }

export type ServerMessage =
  | { t: 'resolved'; id: number; ok: true; path: string; line?: number }
  | { t: 'resolved'; id: number; ok: false; message: string }
  | { t: 'welcome'; host: string; appVersion: string }
  /** The handshake failed (a version mismatch, or the pairing code); the server closes the connection after it. */
  | { t: 'refused'; message: string; reason?: RefusalReason }
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; message: string }
  /** A contract event for remote window `w`. */
  | { t: 'event'; w: number; channel: string; args: unknown[] }
  | { t: 'layouts'; id: number; windows: RemoteWindowLayout[] }

/** One of the server's windows, as the client copies it: its layout record, without bounds. */
export interface RemoteWindowLayout {
  windowNumber: number
  /** The `WindowLayoutRecord` the server's `SessionLayoutStore` holds for it, minus `bounds`. */
  layout: unknown
}

/**
 * A fingerprint of the contract: every key with its kind and channel. Two machines with different
 * contracts would disagree about what a call means, so the handshake refuses them with a message
 * naming both versions instead of failing call by call.
 */
export function contractHash(): string {
  const entries = Object.entries(IPC)
    .map(([key, spec]) => `${key}:${spec.kind}:${'channel' in spec ? spec.channel : ''}`)
    .sort()
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 16)
}

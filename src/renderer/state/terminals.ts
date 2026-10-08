import type { PtyId, TerminalRef } from '@shared/domain/ids'
import type { PtySnapshot } from '@shared/domain/pty'
import { bestEffort } from './policy'

/**
 * Commands on shells and ptys. The output side is `ptyBus` (one listener, fanned out by id) and the
 * pty→session map is `ptySessionsStore`. The calls a terminal makes while the user types are plain
 * sends with nothing to wrap, and they stay one property read away from the bridge: keystrokes and
 * resizes must not get slower.
 */

/** Starts a shell for a tab: next to a session's cwd, or in the folder a pending pty runs in. */
export function spawnShell(terminal: TerminalRef, tabId: string): Promise<void> {
  return terminal.kind === 'pty'
    ? window.apiary.openShellForPty(terminal.id, tabId)
    : window.apiary.openShell(terminal.id, tabId)
}

/** Of these ptys, the ones main still has; null when it could not say (callers then assume nothing). */
export const runningPtys = (ids: PtyId[]): Promise<PtyId[] | null> => bestEffort(window.apiary.ptyRunning(ids), 'pty')

/** The screen to start a view from; null when there is none yet or it could not be fetched: a view
 *  that starts empty is where a brand-new pty starts anyway. */
export const readPtySnapshot = (id: PtyId): Promise<PtySnapshot | null> =>
  bestEffort(window.apiary.ptySnapshot(id), 'pty')

export function writePty(id: PtyId, data: string): void { window.apiary.ptyWrite(id, data) }
export function resizePty(id: PtyId, cols: number, rows: number): void { window.apiary.ptyResize(id, cols, rows) }
export function killPty(id: PtyId): void { window.apiary.ptyKill(id) }
/** SIGCONT: brings back a Claude Code suspended with Ctrl+Z. */
export function continuePty(id: PtyId): void { window.apiary.ptyResume(id) }
/** A view mounted for this pty; output reaches this window only while attached. */
export function attachPty(id: PtyId): void { window.apiary.ptyAttach(id) }
export function detachPty(id: PtyId): void { window.apiary.ptyDetach(id) }

/** Types a prompt into a session's terminal; the composer says "Could not send that message". */
export const sendPrompt = (ptyId: PtyId, text: string): Promise<void> => window.apiary.sendPrompt(ptyId, text)
/** Types `/rename` into a pending session's Claude, so it writes its transcript. */
export function renameTerminalTitle(ptyId: PtyId, title: string): void { window.apiary.renameTerminalInClaude(ptyId, title) }

/** Any pty in main exited. */
export const onAnyPtyExit = (cb: (id: PtyId) => void): (() => void) => window.apiary.onPtyExit(cb)



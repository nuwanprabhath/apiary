import type { AppService } from '../../appService'
import { errorMessage } from '@shared/errors'
import { fireAndForget } from '../../log/fireAndForget'
import { log } from '../../log/logger'
import type { IpcState } from '../ipcState'
import { renameTerminalInClaude, type RenameDeps } from '../../claude/claudeRename'
import type { Handlers, Listeners } from '../registrar'

export interface TerminalsDeps {
  service: AppService
  state: Pick<IpcState, 'sessionTracker'>
}

type HandledKeys = 'openShell' | 'openShellForPty' | 'ptySnapshot' | 'ptySessions' | 'ptyRunning' | 'sendPrompt'
type ListenedKeys = 'ptyWrite' | 'ptyResize' | 'ptyKill' | 'ptyResume' | 'renameTerminalInClaude'

/**
 * Terminals and ptys, plus the Claude session tracker (which session tab a Claude terminal is on
 * — see CLAUDE.md "Which session a terminal is on"). `renameDeps()` is exported for
 * `handlers/sessions.ts`'s `renameSession`, which also renames a running Claude via the same
 * tracker.
 */
export function terminalsHandlers(deps: TerminalsDeps): {
  handlers: Pick<Handlers, HandledKeys>
  listeners: Pick<Listeners, ListenedKeys>
  renameDeps: () => RenameDeps
  dispose: () => void
} {
  const { service } = deps

  const renameDeps = (): RenameDeps => ({
    sessions: () => sessionTracker.current(),
    screen: (ptyId) => service.pty.screen(ptyId),
    write: (ptyId, data) => { service.pty.write(ptyId, data) },
    isAlive: (ptyId) => service.pty.has(ptyId),
  })

  // Which session each Claude terminal is on, followed through /clear, /resume and /rename. The
  // Active section is keyed by these as well, so the tracker's `onChange` (container) tells it too.
  const { sessionTracker } = deps.state
  sessionTracker.start()

  return {
    handlers: {
      openShell: (_e, id, tabId) => service.openShell(id, tabId),
      openShellForPty: (_e, id, tabId) => service.openShellForPty(id, tabId),
      ptySnapshot: (_e, id) => service.pty.snapshot(id),
      ptySessions: () => sessionTracker.current(),
      ptyRunning: (_e, ids) => ids.filter((id) => service.pty.has(id)),
      // Not awaited: delivery waits for the program to be ready (up to ~20s while Claude starts),
      // and the composer clears as soon as the message is handed over. A failure is logged, not
      // dropped.
      sendPrompt: (_e, ptyId, text) => {
        service.sendPrompt(ptyId, text).catch((e: unknown) => {
          log.warn('ipc', 'prompt delivery failed', { error: errorMessage(e) })
        })
      },
    },
    listeners: {
      ptyWrite: (_e, id, data) => service.pty.write(id, data),
      ptyResize: (_e, id, cols, rows) => service.pty.resize(id, cols, rows),
      ptyKill: (_e, id) => service.pty.kill(id),
      ptyResume: (_e, id) => { service.pty.resume(id) },
      renameTerminalInClaude: (_e, ptyId, title) => {
        log.info('rename', 'terminal renamed before it had a session', { ptyId })
        fireAndForget(renameTerminalInClaude(renameDeps(), ptyId, title), 'rename')
      },
    },
    renameDeps,
    dispose: () => { sessionTracker.stop() },
  }
}

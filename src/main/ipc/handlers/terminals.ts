import { join } from 'node:path'
import { CHANNELS } from '@shared/api'
import type { AppService } from '../../appService'
import { log } from '../../log/logger'
import { broadcast } from '../../windows/broadcast'
import { ClaudeSessionTracker } from '../../claude/claudeSessionTracker'
import { renameTerminalInClaude, type RenameDeps } from '../../claude/claudeRename'
import type { Handlers, Listeners } from '../registrar'

export interface TerminalsDeps {
  service: AppService
  configRoot: string
}

type HandledKeys = 'openShell' | 'openShellForPty' | 'ptySnapshot' | 'ptySessions' | 'ptyRunning' | 'sendPrompt'
type ListenedKeys = 'ptyWrite' | 'ptyResize' | 'ptyKill' | 'renameTerminalInClaude'

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
  // Active section is keyed by these as well, so it is told too.
  const sessionTracker = new ClaudeSessionTracker({
    sessionsDir: join(deps.configRoot, 'sessions'),
    pids: () => service.pty.tuiPids(),
    onChange: (sessions) => {
      broadcast(CHANNELS.ptySessionsChanged, sessions)
      broadcast(CHANNELS.activeTabsChanged)
    },
  })
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
          log.warn('ipc', 'prompt delivery failed', { error: e instanceof Error ? e.message : String(e) })
        })
      },
    },
    listeners: {
      ptyWrite: (_e, id, data) => service.pty.write(id, data),
      ptyResize: (_e, id, cols, rows) => service.pty.resize(id, cols, rows),
      ptyKill: (_e, id) => service.pty.kill(id),
      renameTerminalInClaude: (_e, ptyId, title) => {
        log.info('rename', 'terminal renamed before it had a session', { ptyId })
        void renameTerminalInClaude(renameDeps(), ptyId, title).catch(() => { /* best effort */ })
      },
    },
    renameDeps,
    dispose: () => { sessionTracker.stop() },
  }
}

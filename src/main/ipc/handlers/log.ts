import { shell } from 'electron'
import { log } from '../../log/logger'
import type { Handlers, Listeners } from '../registrar'

type HandledKeys = 'logStatus' | 'logReveal' | 'logClear'
type ListenedKeys = 'logWrite'

/** The diagnostic log's own IPC surface — see CLAUDE.md "The diagnostic log". */
export function logHandlers(): {
  handlers: Pick<Handlers, HandledKeys>
  listeners: Pick<Listeners, ListenedKeys>
} {
  return {
    handlers: {
      logStatus: () => log.status(),
      logClear: () => { log.clear(); return log.status() },
      logReveal: async () => {
        const { dir } = log.status()
        // `openPath` on a directory is the one case where handing it to the desktop is right:
        // every platform has something that opens a folder. Revealing the active file instead
        // would show the folder *and* select a file the user is about to be told to attach.
        const error = await shell.openPath(dir)
        if (error !== '') shell.showItemInFolder(dir)
        return dir
      },
    },
    listeners: {
      // The renderer's window into the same log. Sent rather than invoked: a log line is never
      // something the UI should wait on, and a renderer that is logging an error is already
      // having a bad enough time without a round trip.
      logWrite: (_e, level, scope, message, fields) => {
        log.log(level, `renderer:${scope}`, message, fields)
      },
    },
  }
}

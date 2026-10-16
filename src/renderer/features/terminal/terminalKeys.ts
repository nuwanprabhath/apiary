import type { Terminal } from '@xterm/xterm'
import { isClaudeSuspended, isSuspendChord } from '@shared/claudeSuspend'
import { copyText, readClipboardText } from '../../state/clipboard'
import { pasteText } from './terminalPaste'

export interface TerminalKeyContext {
  /** Read on every key: the handler is installed once per pty, so a callback captured at mount
   *  would rename whichever terminal list was current when the terminal was created. */
  renameKey: () => (() => void) | undefined
  claude: () => boolean
  suspended: () => boolean
  askSuspend: () => void
}

/**
 * The terminal's key handler, installed with `term.attachCustomKeyEventHandler`. It must run before
 * xterm processes the key: a DOM listener fires after xterm has written to the pty, so it would
 * copy the selection and still send SIGINT. Returning false stops the key reaching the terminal.
 *
 * Ctrl+C copies only with a selection, else it interrupts. Ctrl+Shift+C always copies, and paste
 * is Ctrl+Shift+V (Cmd+V on macOS), since a bare Ctrl+V is a control character.
 */
export function createTerminalKeyHandler(term: Terminal, ctx: TerminalKeyContext): (e: KeyboardEvent) => boolean {
  const isMac = navigator.userAgent.includes('Mac')
  return (e) => {
    if (e.type !== 'keydown') return true
    // No shell or common terminal program here uses F2, so it is taken before the pty sees it.
    const rename = ctx.renameKey()
    if (e.key === 'F2' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && rename !== undefined) {
      rename()
      return false
    }
    // Claude Code takes Ctrl+Z as "suspend"; asked first (see SuspendConfirmDialog).
    if (ctx.claude() && !ctx.suspended() && isSuspendChord(e)) {
      e.preventDefault()
      ctx.askSuspend()
      return false
    }
    if (!e.ctrlKey && !e.metaKey) return true
    const key = e.key.toLowerCase()

    if (key === 'c' && (e.shiftKey || term.hasSelection())) {
      const selection = term.getSelection()
      if (selection !== '') {
        void copyText(selection)
        term.clearSelection()
      }
      return false
    }

    if (key === 'v' && (e.shiftKey || (isMac && e.metaKey))) {
      // Returning false does not stop the browser's default action: on Linux, Chromium treats
      // Ctrl+Shift+V as a native paste and fires a 'paste' event that xterm also handles (see
      // terminalPaste.ts), pasting twice. Reproduces only on Ubuntu 24.04; macOS has no native
      // Ctrl+Shift+V paste.
      e.preventDefault()
      // The text goes through xterm's `paste()`, the same single write path a native paste uses.
      void readClipboardText().then((text) => { if (text !== null) pasteText(term, text) })
      return false
    }

    return true
  }
}

/** Watches for Claude Code's "has been suspended" screen, whoever caused it. At most once per frame. */
export function watchForSuspension(
  term: Terminal,
  claude: () => boolean,
  current: () => boolean,
  set: (suspended: boolean) => void,
): () => void {
  let disposed = false
  let check: number | null = null
  const parsed = term.onWriteParsed(() => {
    if (!claude() || check !== null) return
    check = requestAnimationFrame(() => {
      check = null
      if (disposed) return
      const buffer = term.buffer.active
      const lines: string[] = []
      for (let i = 0; i < term.rows; i++) {
        lines.push(buffer.getLine(buffer.baseY + i)?.translateToString(true) ?? '')
      }
      const now = isClaudeSuspended(lines)
      if (now !== current()) set(now)
    })
  })
  return () => {
    disposed = true
    parsed.dispose()
    if (check !== null) cancelAnimationFrame(check)
  }
}

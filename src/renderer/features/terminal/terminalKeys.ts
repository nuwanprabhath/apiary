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
 * The terminal's key handler, installed with `term.attachCustomKeyEventHandler` (copy/paste via
 * xterm's own hook rather than a DOM listener).
 *
 * This has to run *before* xterm processes the key and be able to swallow it: a listener on the
 * host element fires after xterm has already written to the pty, so calling preventDefault
 * there would copy the selection and still send SIGINT. Returning false here is what stops the
 * key reaching the terminal at all.
 *
 * Ctrl+C only copies when something is selected — with no selection it must still interrupt
 * whatever is running, which is the single most important key in a terminal. Ctrl+Shift+C
 * always copies (the Linux convention), and paste is Ctrl+Shift+V, or Cmd+V on macOS, since a
 * bare Ctrl+V is a control character a terminal is entitled to receive.
 */
export function createTerminalKeyHandler(term: Terminal, ctx: TerminalKeyContext): (e: KeyboardEvent) => boolean {
  const isMac = navigator.userAgent.includes('Mac')
  return (e) => {
    if (e.type !== 'keydown') return true
    // F2 is the rename key almost everywhere a list of named things exists, and no shell or
    // common terminal program here depends on it — so it is taken before the pty sees it.
    const rename = ctx.renameKey()
    if (e.key === 'F2' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey && rename !== undefined) {
      rename()
      return false
    }
    // Ctrl+Z is "undo" everywhere else people type, and Claude Code takes it as "suspend".
    // Asked first, with "don't" as the default; see SuspendConfirmDialog.
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
      // Returning false below stops xterm's own *keydown*-driven handling, but it does not
      // stop the browser's default action for this chord — on Linux, Chromium treats
      // Ctrl+Shift+V as a native paste shortcut in its own right and, left unprevented, fires
      // a 'paste' DOM event on the textarea as a result of this same keypress. xterm listens
      // for that event independently (see terminalPaste.ts) and would call its own paste()
      // a second time from it. preventDefault() here is what stops that second, browser-issued
      // paste from ever starting — measured against a real Ubuntu 24.04 run, which is the only
      // way this doubling reproduces (a macOS run does not hit it: Ctrl+Shift+V has no native
      // paste action there, only Cmd+V does).
      e.preventDefault()
      // Read the clipboard ourselves only to hand the text to xterm's own `paste()` — not to
      // write it to the pty directly. `paste()` is the same call the browser's native paste
      // event would otherwise drive, so there is exactly one write path instead of two.
      void readClipboardText().then((text) => { if (text !== null) pasteText(term, text) })
      return false
    }

    return true
  }
}

/**
 * Watches for Claude Code's own "has been suspended" screen, whoever caused it — the Suspend
 * button, or a Ctrl+Z that reached it some other way. Checked once per frame at most.
 */
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

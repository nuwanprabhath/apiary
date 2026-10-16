/**
 * The one write path every paste gesture goes through. xterm's `Terminal.paste()` is the only thing
 * that should put clipboard text on a pty: it shares the typed-input `onData` listener and applies
 * bracketed-paste markers only when the program asked. A direct `ptyWrite` from a key handler runs
 * alongside xterm's native `paste` DOM event, so the text lands twice.
 */
import { stripPasteControls } from '@shared/pasteSafe'

export interface PasteableTerminal {
  paste: (text: string) => void
}

export function pasteText(term: PasteableTerminal, text: string): void {
  if (text === '') return
  // xterm's own paste() wraps this in ESC[200~ / ESC[201~ but does not strip either marker from
  // the payload itself, so an ESC[201~ already in the clipboard closes the bracket early and runs
  // whatever follows as keystrokes.
  term.paste(stripPasteControls(text))
}

/**
 * Takes over the native `paste` DOM event (Edit > Paste, Shift+Insert and Linux middle-click arrive
 * that way, not through our key handler) and sends its text through `pasteText`. Registered in the
 * capture phase on an ancestor of xterm's textarea, so it runs before xterm's own listener, which
 * would keep every ESC in the text. Returns the disposer.
 */
export function routeNativePaste(host: HTMLElement, term: PasteableTerminal): () => void {
  const onPaste = (e: ClipboardEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    pasteText(term, e.clipboardData?.getData('text/plain') ?? '')
  }
  host.addEventListener('paste', onPaste, true)
  return () => { host.removeEventListener('paste', onPaste, true) }
}

import type { IDisposable, ILinkHandler, Terminal } from '@xterm/xterm'
import { copyText } from '../../state/clipboard'

const LINK_SCHEMES = new Set(['http:', 'https:'])
/** OSC 52 text longer than this is not put on the clipboard: no sign-in URL comes near it. */
const MAX_CLIPBOARD_CHARS = 1_000_000
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * Opens a link a program printed (an OSC 8 hyperlink: Claude's sign-in URL) in the browser of the
 * machine this window is on, which for a remote window is the home machine. It goes out as a
 * `window.open` of the URL itself, which the window's navigation guard sends to the system browser.
 * xterm's own handler opens a blank window first and sets its address after, and the guard refuses
 * a blank window, so a click did nothing.
 */
function openLink(uri: string): void {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return
  }
  if (LINK_SCHEMES.has(url.protocol)) window.open(url.href, '_blank', 'noopener')
}

/** The terminal's `linkHandler` option. */
export const TERMINAL_LINKS: ILinkHandler = { activate: (_event, uri) => { openLink(uri) } }

/** The text of an OSC 52 clipboard write (`<targets>;<base64>`), or null for a read (`?`) or bad data. */
export function clipboardWriteText(data: string): string | null {
  const semi = data.indexOf(';')
  if (semi === -1) return null
  const payload = data.slice(semi + 1)
  if (payload === '?' || !BASE64.test(payload) || payload.length > MAX_CLIPBOARD_CHARS * 2) return null
  try {
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return text.length > MAX_CLIPBOARD_CHARS ? null : text
  } catch {
    return null
  }
}

/**
 * Puts what a program copies with OSC 52 on this machine's clipboard (Claude's "c to copy" on its
 * sign-in URL). A read (`?`) is never answered: a program never learns what the clipboard holds.
 */
export function copyOnClipboardWrites(term: Terminal): IDisposable {
  return term.parser.registerOscHandler(52, (data) => {
    const text = clipboardWriteText(data)
    if (text !== null && text !== '') void copyText(text)
    return true
  })
}

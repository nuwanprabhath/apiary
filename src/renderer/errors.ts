/**
 * Turning anything that was thrown into something worth putting in front of a person.
 *
 * Electron's `ipcRenderer.invoke` rejects with the main-process message wrapped in two layers of
 * plumbing — `Error invoking remote method 'apiary:transcript': Error: ENOENT: no such file or
 * directory, stat '/…'` — and a raw `Error` reaching a React error boundary is no friendlier.
 * Every path that shows a failure to the user goes through here, so the message reads as a
 * sentence and the noise ends up in the collapsible detail instead of the headline.
 */

/** `Error invoking remote method 'apiary:x': ` and the `Error: ` prefixes Electron re-adds. */
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_PREFIX = /^(?:[A-Za-z]*Error):\s*/

export interface DescribedError {
  /** One line, safe to show as the body of a notification. */
  message: string
  /** The unabridged original — stack included when there was one — for the "Details" expander. */
  detail: string | null
}

export function describeError(thrown: unknown): DescribedError {
  if (thrown instanceof Error) return fromText(thrown.message, thrown.stack ?? null)
  if (typeof thrown === 'string') return fromText(thrown, null)
  // A non-Error rejection (a thrown object, `undefined` from a rejected promise with no reason)
  // still has to say *something*: JSON is the most informative thing available, and it lands in
  // the detail rather than the headline because it is rarely a sentence.
  let detail: string | null = null
  try { detail = JSON.stringify(thrown) } catch { detail = null }
  return { message: 'Something went wrong.', detail }
}

/**
 * Splits one thrown message into a headline and its detail.
 *
 * Detail is the stack when there is one, and otherwise the full message — but only when the
 * headline had to drop something. A single-line message with no stack has nothing left to
 * disclose, and a "Details" toggle that reveals the sentence already on screen is worse than no
 * toggle at all.
 */
function fromText(raw: string, stack: string | null): DescribedError {
  const full = cleanMessage(raw)
  const message = headline(full)
  if (stack !== null) return { message, detail: stack }
  return { message, detail: message === full ? null : full }
}

/**
 * The first line, capped.
 *
 * Some failures arrive as an essay — git's "No configured push destination" carries four lines of
 * advice, indented example commands included — and pasting the whole thing into the headline
 * makes the notification a wall of text nobody reads. The first line is the part that says what
 * went wrong; the rest is still one click away under "Details".
 */
const MAX_HEADLINE_CHARS = 160

function headline(full: string): string {
  const firstLine = full.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? full
  if (firstLine.length <= MAX_HEADLINE_CHARS) return firstLine
  return firstLine.slice(0, MAX_HEADLINE_CHARS).trimEnd() + '…'
}

/** Plumbing prefixes stripped, fs error codes turned into plain words. Newlines preserved. */
function cleanMessage(raw: string): string {
  let text = raw.replace(IPC_PREFIX, '').replace(ERROR_PREFIX, '').trim()
  if (text === '') return 'Something went wrong.'
  // Node's fs errors read as `ENOENT: no such file or directory, stat '/path'`. The code is
  // meaningful to nobody outside a terminal, and the path belongs in the detail.
  const fsError = /^([A-Z]+):\s*(.+?),\s*\w+\s+'(.+)'$/.exec(text)
  if (fsError !== null) {
    const [, , description, path] = fsError
    text = `${description.charAt(0).toUpperCase()}${description.slice(1)}: ${path}`
  }
  return text
}

/**
 * Electron's `ipcRenderer.invoke` rejects with the main-process message wrapped in two layers of
 * plumbing — `Error invoking remote method 'apiary:transcript': Error: ENOENT: no such file or
 * directory, stat '/…'`. The noise ends up in the collapsible detail instead of the headline.
 */

/** `Error invoking remote method 'apiary:x': ` and the `Error: ` prefixes Electron re-adds. */
const IPC_PREFIX = /^Error invoking remote method '[^']*':\s*/
const ERROR_PREFIX = /^(?:[A-Za-z]*Error):\s*/

export interface DescribedError {
  message: string
  /** The unabridged original, stack included, for the "Details" expander. */
  detail: string | null
}

export function describeError(thrown: unknown): DescribedError {
  if (thrown instanceof Error) return fromText(thrown.message, thrown.stack ?? null)
  if (typeof thrown === 'string') return fromText(thrown, null)
  let detail: string | null
  try { detail = JSON.stringify(thrown) } catch { detail = null }
  return { message: 'Something went wrong.', detail }
}

/** The notification for a region an `ErrorBoundary` gave up on. Plain data, so this file does not depend on the notification provider. */
export function crashNotice(what: string, thrown: unknown, componentStack: string): { kind: 'error'; message: string; detail: string } {
  const { message, detail } = describeError(thrown)
  return {
    kind: 'error',
    message: `${what} could not be displayed: ${message}`,
    detail: [detail, componentStack].filter((t) => t !== null && t !== '').join('\n'),
  }
}

/** Detail is the stack, else the full message only when the headline dropped something. */
function fromText(raw: string, stack: string | null): DescribedError {
  const full = cleanMessage(raw)
  const message = headline(full)
  if (stack !== null) return { message, detail: stack }
  return { message, detail: message === full ? null : full }
}

/** Some failures arrive as an essay (git's "No configured push destination" carries four lines of advice). */
const MAX_HEADLINE_CHARS = 160

/**
 * Git prints progress before the failure — `Auto-merging README.md` ahead of the `CONFLICT` line,
 * `To origin` ahead of `error: failed to push` — so for git the first line is the least useful
 * one. A line where git itself states the failure wins over the first line.
 */
const GIT_FAILURE_LINE = /^(?:CONFLICT\b|fatal:|error:)/

function headline(full: string): string {
  const lines = full.split('\n').map((l) => l.trim()).filter((l) => l !== '')
  const firstLine = lines.find((l) => GIT_FAILURE_LINE.test(l)) ?? lines[0] ?? full
  if (firstLine.length <= MAX_HEADLINE_CHARS) return firstLine
  return firstLine.slice(0, MAX_HEADLINE_CHARS).trimEnd() + '…'
}

function cleanMessage(raw: string): string {
  let text = raw.replace(IPC_PREFIX, '').replace(ERROR_PREFIX, '').trim()
  if (text === '') return 'Something went wrong.'
  // Node's fs errors read as `ENOENT: no such file or directory, stat '/path'`.
  const fsError = /^([A-Z]+):\s*(.+?),\s*\w+\s+'(.+)'$/.exec(text)
  if (fsError !== null) {
    const [, , description, path] = fsError
    text = `${description.charAt(0).toUpperCase()}${description.slice(1)}: ${path}`
  }
  return text
}

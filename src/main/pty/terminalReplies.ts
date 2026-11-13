/**
 * Queries a program sends its terminal, and the terminal's replies, as bytes on a pty.
 *
 * A program asks (`ESC ] 11 ; ?` for the background colour, `ESC [ c` for the device attributes,
 * `ESC [ 6 n` for the cursor) and reads the answer from its input. The view that answers is the
 * xterm in a window, so in a remote window the answer crosses the network and can land after the
 * program has given up and exited; the shell then reads it as typing and the prompt shows
 * `11;rgb:0a0a/0e0e/1e1e`. `PtyManager` drops a reply once the program in front is no longer the
 * one that asked.
 */

const ESC = '\u001b'
const ST = `(?:\u0007|${ESC}\\\\)`

/** A query a terminal answers: device attributes, status and cursor reports, a colour query, a mode query, a size query. */
const QUERY = new RegExp([
  `${ESC}\\[[>=]?0?c`,
  `${ESC}\\[\\??[56]n`,
  `${ESC}\\](?:1[0-9]|4;\\d+);\\?${ST}`,
  `${ESC}\\[\\??\\d+\\$p`,
  `${ESC}\\[1[468]t`,
].join('|'))

/** One reply to such a query. */
const REPLY = [
  `${ESC}\\[[?>=][\\d;]*c`,
  `${ESC}\\[\\??\\d+(?:;\\d+)?[nR]`,
  `${ESC}\\]\\d+(?:;\\d+)?;rgb:[0-9a-fA-F/]+${ST}`,
  `${ESC}\\[\\??\\d+;\\d+\\$y`,
  `${ESC}\\[[48];\\d+;\\d+t`,
].join('|')
const ONLY_REPLIES = new RegExp(`^(?:${REPLY})+$`)

/** How long after a query a reply to it is still expected; later than this, a reply is passed on as it is. */
export const REPLY_WINDOW_MS = 10_000

/** Whether pty output asks the terminal something it answers. */
export function asksTerminal(output: string): boolean {
  return output.includes(ESC) && QUERY.test(output)
}

/** Whether input written to a pty is nothing but replies to terminal queries (never typed text). */
export function isTerminalReply(input: string): boolean {
  return input.startsWith(ESC) && ONLY_REPLIES.test(input)
}

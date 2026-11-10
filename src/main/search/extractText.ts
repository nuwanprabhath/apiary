import { decodeEntry, type MessageContent } from '../transcript/claudeEntry'

/** Re-exported for `knowledge/`, whose allowed imports (`MAIN_EDGES`) include `search` but not `transcript`. */
export { decodeEntry }

/**
 * Pulls the searchable text out of a session's JSONL.
 *
 * What goes in is what someone might remember and search by: what they asked, what Claude said, and
 * the *names* in tool calls — a branch checked out, a file edited, a merge request opened. What
 * stays out is bulk tool output, which is where most of the bytes are and almost none of the
 * recall; the index would pay for them twice, in size and in every query that ranks them.
 */

/** Text blocks, plus short string fields from tool inputs (paths, branches, commands, urls). */
function fromContent(content: MessageContent, out: string[]): void {
  if (typeof content === 'string') {
    out.push(content)
    return
  }
  if (content === undefined) return
  for (const b of content) {
    if (b.type === 'text' && b.text !== undefined) out.push(b.text)
    if (b.type === 'tool_use' && typeof b.input === 'object' && b.input !== null) {
      for (const value of Object.values(b.input)) {
        // Short strings only: long fields are file contents and diffs, the bulk left out above.
        if (typeof value === 'string' && value.length <= 400) out.push(value)
      }
    }
  }
}

/**
 * The searchable text of one JSONL line, or null when there is nothing worth indexing in it.
 *
 * Unparseable lines are skipped rather than throwing: a session file is appended to while it is
 * being read, so a truncated final line is normal rather than corruption.
 */
export function extractLineText(line: string): string | null {
  if (line.trim() === '') return null
  const entry = decodeEntry(line)
  if (entry === null) return null

  const out: string[] = []
  // Indexed with the body so a title match and a content match are one search.
  if (entry.title !== undefined) out.push(entry.title)

  if (entry.message) fromContent(entry.message.content, out)
  fromContent(entry.content, out)

  const text = out.join(' ').replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

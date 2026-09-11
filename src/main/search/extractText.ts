/**
 * Pulls the searchable text out of a session's JSONL.
 *
 * What goes in is what someone might remember and search by: what they asked, what Claude said, and
 * the *names* in tool calls — a branch checked out, a file edited, a merge request opened. What
 * stays out is bulk tool output, which is where most of the bytes are and almost none of the
 * recall: nobody searches for the 400 lines a test run printed, but the index pays for them twice,
 * once in size and once in every query that has to rank them.
 */

/** Text blocks, plus short string fields from tool inputs (paths, branches, commands, urls). */
function fromContent(content: unknown, out: string[]): void {
  if (typeof content === 'string') {
    out.push(content)
    return
  }
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') out.push(b.text)
    if (b.type === 'tool_use' && typeof b.input === 'object' && b.input !== null) {
      for (const value of Object.values(b.input as Record<string, unknown>)) {
        // Short strings only: a tool input's long fields are file contents and diffs, which are
        // the same bulk this deliberately leaves out.
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
  let entry: Record<string, unknown>
  try {
    entry = JSON.parse(line) as Record<string, unknown>
  } catch {
    return null
  }

  const out: string[] = []
  // The session's own title is worth indexing with the body, so a title match and a content match
  // are one search rather than two that have to be combined by the caller.
  if (typeof entry.title === 'string') out.push(entry.title)

  const message = entry.message
  if (typeof message === 'object' && message !== null) {
    fromContent((message as Record<string, unknown>).content, out)
  }
  fromContent(entry.content, out)

  const text = out.join(' ').replace(/\s+/g, ' ').trim()
  return text === '' ? null : text
}

import type { TranscriptMessage } from '../domain/transcript'
import { describeTool } from '../chatTimeline'

/** What a pet may be told Claude is doing, at most this long. */
export const ACTION_CHARS = 80

const TITLED = new Set(['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Task', 'Agent'])

/** Tools by what they are doing, in words a pet can riff on when there is no title to give. */
const VERBS: Record<string, string> = {
  Bash: 'running a command', Read: 'reading a file', Write: 'writing a file', Edit: 'editing a file',
  MultiEdit: 'editing a file', Grep: 'searching the code', Glob: 'looking for files', WebFetch: 'reading a web page',
  WebSearch: 'searching the web', Task: 'handing work to a helper', Agent: 'handing work to a helper', TodoWrite: 'planning its work',
}

/**
 * What Claude is doing right now, as one short phrase: the latest tool call's name and its title —
 * "Edit: csvWriter.ts", "Bash: Run the e2e suite" — and nothing else. Never the command, never a
 * file's contents or a tool's output, never anything said in the conversation: that is what the
 * user agreed pets may see (1.31.0). Null while Claude is only writing.
 */
export function latestAction(messages: TranscriptMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role !== 'assistant' || m.isSidechain) continue
    for (let j = m.blocks.length - 1; j >= 0; j--) {
      const b = m.blocks[j]
      if (b.type !== 'tool_use') continue
      // Only titles that are a label for the action: Bash's description, a file's name, a helper's
      // task. A search pattern, a URL or a query is closer to content than to an action.
      const title = TITLED.has(b.name) ? describeTool(b.name, b.input).title.replace(/\s+/g, ' ').trim() : ''
      const name = b.name.replace(/[^\w-]/g, '').slice(0, 32)
      const phrase = title !== '' ? `${name}: ${title}` : (VERBS[b.name] ?? `using ${name}`)
      return [...phrase].slice(0, ACTION_CHARS).join('')
    }
    return null
  }
  return null
}

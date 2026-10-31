import { lastPathSegment } from '@shared/text'
import { isRecord } from '@shared/guards'

/** What a resident says it is doing while it streams its answer. */
export const WRITING = 'Writing'
/** While it thinks before answering. */
export const THINKING = 'Thinking'
/** A running turn with nothing more specific to say. */
export const WORKING = 'Working'
/** While a resident just turned on starts its claude. */
export const STARTING = 'Starting'

/** The status bar has room for a few words; the popup shows the same text. */
const MAX_ACTIVITY = 40

/** The prefix claude puts on a tool from the `apiary` MCP server. */
const APIARY_TOOL = 'mcp__apiary__'
/** Any MCP server's tool: `mcp__<server>__<tool>`. */
const MCP_TOOL_RE = /^mcp__(.+?)__/
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
/** Where a shell command's head ends: what follows is another command or a redirection. */
const SHELL_BREAK_RE = /[;|&<>]/
const HEAD_WORDS = 3

export function clipActivity(text: string): string {
  return text.length <= MAX_ACTIVITY ? text : `${text.slice(0, MAX_ACTIVITY - 1)}…`
}

/** "Running mra prompt 1559": up to three words of the command, without flags or what follows `;`, `&&` or `|`. */
function commandHead(command: string): string {
  const words: string[] = []
  for (const word of command.trim().split(/\s+/)) {
    const end = word.search(SHELL_BREAK_RE)
    const head = end < 0 ? word : word.slice(0, end)
    if (head !== '' && !head.startsWith('-')) words.push(head)
    if (end >= 0 || words.length === HEAD_WORDS) break
  }
  return words.length === 0 ? 'Running a command' : `Running ${words.join(' ')}`
}

function hostOf(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try {
    return new URL(url).host || null
  } catch {
    return null // not a URL: the line says "the web" instead
  }
}

/** Claude Code's own tools, by name; null for one it does not know. */
function builtinActivity(name: string, args: Record<string, unknown>): string | null {
  if (name === 'Bash') return typeof args.command === 'string' ? commandHead(args.command) : 'Running a command'
  if (name === 'Agent' || name === 'Task') {
    const description = typeof args.description === 'string' ? args.description.trim() : ''
    return description === '' ? 'Reviewing with a helper' : `Helper: ${description}`
  }
  if (name === 'WebSearch') return 'Searching the web'
  if (name === 'WebFetch') return `Reading ${hostOf(args.url) ?? 'the web'}`
  if (name === 'Read' || name === 'Grep' || name === 'Glob') return 'Reading files'
  if (EDIT_TOOLS.has(name)) {
    const path = [args.file_path, args.notebook_path].find((p) => typeof p === 'string')
    return typeof path === 'string' ? `Editing ${lastPathSegment(path)}` : 'Editing files'
  }
  return null
}

function apiaryActivity(tool: string, args: Record<string, unknown>, titleOf: (sessionId: string) => string | null): string {
  const title = (typeof args.sessionId === 'string' ? titleOf(args.sessionId) : null) ?? 'a session'
  if (tool === 'find_sessions') return 'Searching sessions'
  if (tool === 'session_topics') return `Skimming ${title}`
  if (tool === 'read_session') return `Reading ${title}`
  if (tool === 'open_session') return `Opening ${title}`
  if (tool.startsWith('note_')) return 'Checking notes'
  if (tool === 'apiary_status') return 'Checking Apiary'
  return WORKING
}

/**
 * A few words for any tool call claude made, cut at 40 characters: Apiary's own, Claude Code's,
 * "Using <server>" for another MCP server's, and "Working" for one it does not know. Pure: a
 * session's title comes from `titleOf`, which the caller answers from the session store.
 */
export function activityForTool(name: string, input: unknown, titleOf: (sessionId: string) => string | null): string {
  const args = isRecord(input) ? input : {}
  if (name.startsWith(APIARY_TOOL)) return clipActivity(apiaryActivity(name.slice(APIARY_TOOL.length), args, titleOf))
  const mcp = MCP_TOOL_RE.exec(name)
  if (mcp !== null) return clipActivity(`Using ${mcp[1]}`)
  return clipActivity(builtinActivity(name, args) ?? WORKING)
}

const SUMMARY_MAX = 120

/** One line for a tool use waiting on the user: "Run: <command>", "Edit <file name>", or the tool's name. */
export function permissionSummary(tool: string, input: unknown): string {
  const args = isRecord(input) ? input : {}
  let line = tool
  if (tool === 'Bash' && typeof args.command === 'string') line = `Run: ${args.command.replace(/\s+/g, ' ').trim()}`
  else if (EDIT_TOOLS.has(tool)) {
    const path = [args.file_path, args.notebook_path].find((p) => typeof p === 'string')
    const name = typeof path === 'string' ? lastPathSegment(path) : ''
    line = name === '' ? tool : `Edit ${name}`
  }
  return line.length <= SUMMARY_MAX ? line : `${line.slice(0, SUMMARY_MAX - 1)}…`
}

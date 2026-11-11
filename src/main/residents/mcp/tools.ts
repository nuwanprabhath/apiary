import { errorMessage } from '@shared/errors'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import type { ResidentAttention, SessionHit } from '@shared/domain/residents'
import type { ResidentCapability } from '../kinds'
import { ATTENTION_COUNT_MAX, ATTENTION_SUMMARY_MAX, NOTE_KEY_MAX, NOTE_TEXT_MAX } from '../residentSpace'
import { GITLAB_TOOLS } from './gitlabTools'
import { fail, intIn, ok, text, tool, type Tool, type ToolDeps } from './toolKit'

const NO_INDEX = 'The session index is not available.'

const FIND_LIMIT = 20
const READ_MAX = 20000
const READ_DEFAULT = 8000
const QUERY_MAX = 500


/** A session id from the agent, checked against the store: an id it made up is an error result. */
function knownSession(args: Record<string, unknown>, deps: ToolDeps): { id: SessionId; title: string } | string {
  const id = typeof args.sessionId === 'string' ? args.sessionId : ''
  const found = id === '' ? null : deps.session(id)
  return found === null ? `Unknown session id: ${id.slice(0, 80)}` : { id: asSessionId(id), title: found.title }
}

const sessionIdSchema = { sessionId: { type: 'string', description: 'A session id from find_sessions.' } }

function hitLine(hit: SessionHit): string {
  const where = [hit.folder, hit.branch].filter((s) => s !== null && s !== '').join(' · ')
  const why = hit.topic !== null ? `${hit.reason}: ${hit.topic}` : hit.reason
  const snippet = hit.snippet !== null ? ` — ${hit.snippet}` : ''
  return `- ${hit.title} (id: ${hit.sessionId}) · ${where} · last active ${new Date(hit.lastActive).toISOString()} · ${why}${snippet}`
}

const SESSION_TOOLS: Tool[] = [
  tool<{ query: string; limit: number }>({
    name: 'find_sessions',
    capability: 'sessions.read',
    description: 'Find the user\'s Claude Code sessions by a reference (!123, #45, ABC-12, an MR or issue URL), a topic, words in the conversation, or a title, branch or folder. Ranked, best first.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: FIND_LIMIT } },
      required: ['query'],
    },
    parse: (a) => {
      const query = text(a.query, QUERY_MAX)
      const limit = a.limit === undefined ? 10 : intIn(a.limit, 1, FIND_LIMIT)
      if (query === null) return `query is 1 to ${String(QUERY_MAX)} characters.`
      return limit === null ? `limit is 1 to ${String(FIND_LIMIT)}.` : { query, limit }
    },
    run: async ({ query, limit }, _call, deps) => {
      if (deps.knowledge === null) return fail(NO_INDEX)
      const hits = await deps.knowledge.find(query, limit)
      return ok(hits.length === 0 ? 'No sessions matched.' : hits.map(hitLine).join('\n'))
    },
  }),
  tool<{ id: SessionId }>({
    name: 'session_topics',
    capability: 'sessions.read',
    description: 'The topics of one session, from its digest: a title, summary, references and line range for each.',
    inputSchema: { type: 'object', properties: sessionIdSchema, required: ['sessionId'] },
    parse: (a) => (typeof a.sessionId === 'string' ? { id: asSessionId(a.sessionId) } : 'sessionId is required.'),
    run: async ({ id }, _call, deps) => {
      const session = knownSession({ sessionId: id }, deps)
      if (typeof session === 'string') return fail(session)
      if (deps.knowledge === null) return fail(NO_INDEX)
      const topics = await deps.knowledge.topics(session.id)
      if (topics.length === 0) return ok(`${session.title} has no digest yet; use read_session.`)
      return ok(topics.map((t) => [
        `## ${t.title} (topic ${t.id}, lines ${String(t.startLine)}–${String(t.endLine)})`,
        t.summary,
        t.refs.length > 0 ? `refs: ${t.refs.join(', ')}` : '',
      ].filter((l) => l !== '').join('\n')).join('\n\n'))
    },
  }),
  tool<{ id: SessionId; topicId?: string; query?: string; maxChars: number }>({
    name: 'read_session',
    capability: 'sessions.read',
    description: 'The user and assistant text of one session: around a topic, around the query\'s matches, or else its end.',
    inputSchema: {
      type: 'object',
      properties: {
        ...sessionIdSchema,
        topicId: { type: 'string' },
        query: { type: 'string' },
        maxChars: { type: 'integer', minimum: 200, maximum: READ_MAX },
      },
      required: ['sessionId'],
    },
    parse: (a) => {
      if (typeof a.sessionId !== 'string') return 'sessionId is required.'
      const maxChars = a.maxChars === undefined ? READ_DEFAULT : intIn(a.maxChars, 200, READ_MAX)
      if (maxChars === null) return `maxChars is 200 to ${String(READ_MAX)}.`
      const topicId = text(a.topicId, 200)
      const query = text(a.query, QUERY_MAX)
      return { id: asSessionId(a.sessionId), maxChars, ...(topicId !== null ? { topicId } : {}), ...(query !== null ? { query } : {}) }
    },
    run: async ({ id, ...options }, _call, deps) => {
      const session = knownSession({ sessionId: id }, deps)
      if (typeof session === 'string') return fail(session)
      if (deps.knowledge === null) return fail(NO_INDEX)
      const body = await deps.knowledge.read(session.id, options)
      return body === null ? fail(`Could not read ${session.title}.`) : ok(body.slice(0, options.maxChars))
    },
  }),
]

const WORKSPACE_TOOLS: Tool[] = [
  tool<{ id: SessionId }>({
    name: 'open_session',
    capability: 'workspace.open',
    description: 'Show a session to the user: its tab is focused if it is open in any window, otherwise it opens in the focused pane.',
    inputSchema: { type: 'object', properties: sessionIdSchema, required: ['sessionId'] },
    parse: (a) => (typeof a.sessionId === 'string' ? { id: asSessionId(a.sessionId) } : 'sessionId is required.'),
    run: ({ id }, _call, deps) => {
      const session = knownSession({ sessionId: id }, deps)
      if (typeof session === 'string') return fail(session)
      deps.openSession(session.id)
      return ok(`Opened ${session.title}.`)
    },
  }),
  tool<Record<string, never>>({
    name: 'list_open_tabs',
    capability: 'workspace.read',
    description: 'The sessions open as tabs in each Apiary window, and which window is in front.',
    inputSchema: { type: 'object', properties: {} },
    parse: () => ({}),
    run: (_args, _call, deps) => {
      const tabs = deps.openTabs()
      if (tabs.length === 0) return ok('No tabs are open.')
      const focused = deps.focusedWindow()
      const windows = [...new Set(tabs.map((t) => t.windowNumber))].sort((a, b) => a - b)
      return ok(windows.map((w) => [
        `Window ${String(w)}${w === focused ? ' (in front)' : ''}:`,
        ...tabs.filter((t) => t.windowNumber === w).map((t) => {
          const title = deps.session(t.key)?.title ?? t.label ?? 'New session'
          return deps.session(t.key) !== null ? `- ${title} (id: ${t.key}, ${t.view})` : `- ${title} (${t.view})`
        }),
      ].join('\n')).join('\n'))
    },
  }),
]

const NOTE_TOOLS: Tool[] = [
  tool<{ key: string }>({
    name: 'note_get',
    capability: 'space.notes',
    description: 'Read one of your own notes by key.',
    inputSchema: { type: 'object', properties: { key: { type: 'string', maxLength: NOTE_KEY_MAX } }, required: ['key'] },
    parse: (a) => {
      const key = text(a.key, NOTE_KEY_MAX)
      return key === null ? `key is 1 to ${String(NOTE_KEY_MAX)} characters.` : { key }
    },
    run: ({ key }, { space }) => {
      const notes = space.notes()
      const note = Object.hasOwn(notes, key) ? notes[key] : undefined
      return note !== undefined ? ok(note) : ok(`No note called "${key}".`)
    },
  }),
  tool<{ key: string; text: string }>({
    name: 'note_put',
    capability: 'space.notes',
    description: 'Save a note under a key (replacing any there): aliases the user teaches you, preferences, things to remember.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string', maxLength: NOTE_KEY_MAX }, text: { type: 'string', maxLength: NOTE_TEXT_MAX } },
      required: ['key', 'text'],
    },
    parse: (a) => {
      const key = text(a.key, NOTE_KEY_MAX)
      if (key === null) return `key is 1 to ${String(NOTE_KEY_MAX)} characters.`
      return typeof a.text === 'string' && a.text.length <= NOTE_TEXT_MAX ? { key, text: a.text } : `text is at most ${String(NOTE_TEXT_MAX)} characters.`
    },
    run: ({ key, text: body }, { space }) => {
      try {
        space.putNote(key, body)
        return ok(`Saved "${key}".`)
      } catch (e) {
        return fail(errorMessage(e))
      }
    },
  }),
  tool<Record<string, never>>({
    name: 'note_list',
    capability: 'space.notes',
    description: 'Every note you have saved: each key and the start of its text.',
    inputSchema: { type: 'object', properties: {} },
    parse: () => ({}),
    run: (_args, { space }) => {
      const entries = Object.entries(space.notes())
      return ok(entries.length === 0 ? 'No notes yet.' : entries.map(([k, v]) => `- ${k}: ${v.length > 160 ? `${v.slice(0, 159)}…` : v}`).join('\n'))
    },
  }),
]

const ACTIVITY_MAX = 40
const NO_ARGS = { type: 'object', properties: {} }

const SELF_TOOLS: Tool[] = [
  tool<Record<string, never>>({
    name: 'apiary_status',
    capability: 'apiary.status',
    description: 'Your own state: on duty or not, your schedule, the digest\'s progress and lookback, the knowledge index\'s size, and the other residents.',
    inputSchema: NO_ARGS,
    parse: () => ({}),
    run: (_args, { residentId }, deps) => ok(deps.residents.statusText(residentId)),
  }),
  tool<ResidentAttention>({
    name: 'set_attention',
    capability: 'resident.attention',
    description: 'Flag that you need the user (MRs waiting, a question): count is how many things wait (0 for one unnumbered thing), summary one short line. It stays until the user opens your chat.',
    inputSchema: {
      type: 'object',
      properties: { count: { type: 'integer', minimum: 0, maximum: ATTENTION_COUNT_MAX }, summary: { type: 'string', maxLength: ATTENTION_SUMMARY_MAX } },
      required: ['count', 'summary'],
    },
    parse: (a) => {
      const count = intIn(a.count, 0, ATTENTION_COUNT_MAX)
      if (count === null) return `count is a whole number from 0 to ${String(ATTENTION_COUNT_MAX)}.`
      const summary = text(a.summary, ATTENTION_SUMMARY_MAX)
      return summary === null ? `summary is 1 to ${String(ATTENTION_SUMMARY_MAX)} characters.` : { count, summary: summary.trim() }
    },
    run: (attention, { residentId }, deps) => {
      deps.residents.setAttention(residentId, attention)
      return ok('Flagged.')
    },
  }),
  tool<Record<string, never>>({
    name: 'clear_attention',
    capability: 'resident.attention',
    description: 'Clear your "needs you" flag: nothing waits for the user any more.',
    inputSchema: NO_ARGS,
    parse: () => ({}),
    run: (_args, { residentId }, deps) => {
      deps.residents.setAttention(residentId, null)
      return ok('Cleared.')
    },
  }),
  tool<{ text: string }>({
    name: 'set_activity',
    capability: 'resident.attention',
    description: `Say in a few words what you are doing, for your badge (at most ${String(ACTIVITY_MAX)} characters). Your next tool call or the end of your turn replaces it.`,
    inputSchema: { type: 'object', properties: { text: { type: 'string', maxLength: 200 } }, required: ['text'] },
    parse: (a) => {
      const words = text(a.text, 200)
      return words === null ? 'text is 1 to 200 characters.' : { text: words.trim().replace(/\s+/g, ' ') }
    },
    run: ({ text: words }, { residentId }, deps) => {
      deps.residents.setActivity(residentId, words)
      return ok('Shown.')
    },
  }),
]

/** Every Apiary tool. A new capability's tools are added here; a kind opts in by listing the capability. */
const APIARY_TOOLS: readonly Tool[] = [...SESSION_TOOLS, ...WORKSPACE_TOOLS, ...NOTE_TOOLS, ...SELF_TOOLS, ...GITLAB_TOOLS]

/** The tools a kind with `capabilities` may see and call. */
export function toolsFor(capabilities: readonly ResidentCapability[]): Tool[] {
  return APIARY_TOOLS.filter((t) => capabilities.includes(t.capability))
}

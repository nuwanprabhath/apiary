import type { WorktreeCreateRequest } from '@shared/domain/git'
import { asSessionId, type SessionId } from '@shared/domain/ids'
import { errorMessage } from '@shared/errors'
import type { DeskControls } from './deskControl'
import { fail, ok, text, tool, type Tool, type ToolDeps, type ToolResult } from './toolKit'

const NOT_CONNECTED = 'Slack is not connected on this machine.'
const TASK_ID = /^\d{9,12}\.\d{1,8}$/
const DESK_TEXT_MAX = 20000
const NAME_MAX = 200
const TASK_HELP = 'taskId is the Slack task id from the "[Slack task <id>]" message, like 1700000000.123456.'

const taskIdSchema = { taskId: { type: 'string', description: 'The Slack task this is for, from the "[Slack task <id>]" message.' } }
const sessionIdSchema = { sessionId: { type: 'string', description: 'A session id from find_sessions.' } }

/** Runs `body` with the desk's controls, or says Slack is not connected. Any throw becomes an error result. */
async function withDesk(deps: ToolDeps, body: (desk: DeskControls) => Promise<ToolResult> | ToolResult): Promise<ToolResult> {
  const desk = deps.desk?.() ?? null
  if (desk === null) return fail(NOT_CONNECTED)
  try {
    return await body(desk)
  } catch (e) {
    return fail(errorMessage(e).slice(0, 300))
  }
}

/** `null` when absent; a sentence when present but not a task id. */
function optionalTask(v: unknown): string | null | { problem: string } {
  if (v === undefined || v === null) return null
  return typeof v === 'string' && TASK_ID.test(v) ? v : { problem: TASK_HELP }
}

function sessionOf(a: Record<string, unknown>): string | null {
  return typeof a.sessionId === 'string' && a.sessionId !== '' ? a.sessionId : null
}

function known(id: string, deps: ToolDeps): { id: SessionId; title: string } | string {
  const found = deps.session(id)
  return found === null ? `Unknown session id: ${id.slice(0, 80)}` : { id: asSessionId(id), title: found.title }
}

interface SessionArgs { sessionId: string; taskId: string | null }

function parseSessionTask(a: Record<string, unknown>): SessionArgs | string {
  const sessionId = sessionOf(a)
  if (sessionId === null) return 'sessionId is required.'
  const task = optionalTask(a.taskId)
  return typeof task === 'object' && task !== null ? task.problem : { sessionId, taskId: task }
}

interface StartArgs { folderId: string; text: string; worktree: WorktreeCreateRequest | null; taskId: string | null }

function parseWorktree(v: unknown): WorktreeCreateRequest | null | string {
  if (v === undefined || v === null) return null
  const w = typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const name = text(w.name, NAME_MAX)
  const branch = text(w.branch, NAME_MAX)
  if (name === null || branch === null || typeof w.newBranch !== 'boolean') return 'worktree needs a name, a branch and newBranch (true or false).'
  if (w.newBranch) {
    const from = w.from === undefined ? undefined : text(w.from, NAME_MAX)
    if (from === null) return 'worktree.from is a branch name.'
    return { name, branch: from === undefined ? { kind: 'new', branch } : { kind: 'new', branch, from } }
  }
  return { name, branch: { kind: 'local', branch } }
}

const folderLine = (f: ReturnType<DeskControls['drive']['folders']>[number]): string =>
  `- ${f.name} (id: ${f.id}) · ${f.branch ?? 'no branch'}${f.worktreeOf === null ? '' : ` · worktree of ${f.worktreeOf}`}`

const DRIVE = 'sessions.drive' as const
const DELEGATE = 'residents.delegate' as const
const SLACK = 'slack.post' as const

export const DESK_TOOLS: Tool[] = [
  tool<Record<string, never>>({
    name: 'list_folders', capability: DRIVE,
    description: 'The folders and worktrees a new session can start in: name, id, branch.',
    inputSchema: { type: 'object', properties: {} },
    parse: () => ({}),
    run: (_a, _c, deps) => withDesk(deps, (d) => {
      const folders = d.drive.folders()
      return ok(folders.length === 0 ? 'No folders.' : folders.map(folderLine).join('\n'))
    }),
  }),
  tool<SessionArgs & { text: string }>({
    name: 'send_to_session', capability: DRIVE,
    description: 'Send a message to an existing session as the user would. With taskId, Apiary watches the session for that Slack task and tells you what it does.',
    inputSchema: { type: 'object', properties: { ...sessionIdSchema, text: { type: 'string' }, ...taskIdSchema }, required: ['sessionId', 'text'] },
    parse: (a) => {
      const base = parseSessionTask(a)
      const body = text(a.text, DESK_TEXT_MAX)
      if (typeof base === 'string') return base
      return body === null ? `text is 1 to ${String(DESK_TEXT_MAX)} characters.` : { ...base, text: body }
    },
    run: (a, _c, deps) => withDesk(deps, async (d) => {
      const s = known(a.sessionId, deps)
      if (typeof s === 'string') return fail(s)
      const how = await d.drive.send(s.id, a.text, a.taskId)
      return ok(how === 'sent' ? `Sent to ${s.title}.` : `${s.title} is busy in its terminal; it gets the message when its turn ends.`)
    }),
  }),
  tool<StartArgs>({
    name: 'start_session', capability: DRIVE,
    description: 'Start a new session in a folder (from list_folders), optionally in a new worktree, with the request as its first message. With taskId, Apiary watches it for that Slack task.',
    inputSchema: {
      type: 'object',
      properties: {
        folderId: { type: 'string' }, text: { type: 'string' }, ...taskIdSchema,
        worktree: {
          type: 'object',
          properties: { name: { type: 'string' }, branch: { type: 'string' }, newBranch: { type: 'boolean' }, from: { type: 'string' } },
          required: ['name', 'branch', 'newBranch'],
        },
      },
      required: ['folderId', 'text'],
    },
    parse: (a) => {
      const folderId = text(a.folderId, NAME_MAX)
      const body = text(a.text, DESK_TEXT_MAX)
      const worktree = parseWorktree(a.worktree)
      const task = optionalTask(a.taskId)
      if (folderId === null) return 'folderId is required (from list_folders).'
      if (body === null) return `text is 1 to ${String(DESK_TEXT_MAX)} characters.`
      if (typeof worktree === 'string') return worktree
      if (typeof task === 'object' && task !== null) return task.problem
      return { folderId, text: body, worktree, taskId: task }
    },
    run: (a, _c, deps) => withDesk(deps, async (d) => {
      const started = await d.drive.start(a.folderId, a.text, a.worktree, a.taskId)
      return ok(`Started a new session in ${started.folderName} (id: ${started.sessionId}).`)
    }),
  }),
  tool<{ sessionId: string }>({
    name: 'interrupt_session', capability: DRIVE,
    description: 'Stop the session\'s current turn.',
    inputSchema: { type: 'object', properties: sessionIdSchema, required: ['sessionId'] },
    parse: (a) => { const id = sessionOf(a); return id === null ? 'sessionId is required.' : { sessionId: id } },
    run: (a, _c, deps) => withDesk(deps, (d) => {
      const s = known(a.sessionId, deps)
      if (typeof s === 'string') return fail(s)
      d.drive.interrupt(s.id)
      return ok(`Interrupted ${s.title}.`)
    }),
  }),
  tool<SessionArgs>({
    name: 'watch_session', capability: DRIVE,
    description: 'Watch a session: Apiary tells you when its turns end. With taskId, for that Slack task.',
    inputSchema: { type: 'object', properties: { ...sessionIdSchema, ...taskIdSchema }, required: ['sessionId'] },
    parse: parseSessionTask,
    run: (a, _c, deps) => withDesk(deps, (d) => {
      const s = known(a.sessionId, deps)
      if (typeof s === 'string') return fail(s)
      d.drive.watch(s.id, a.taskId)
      return ok(`Watching ${s.title}.`)
    }),
  }),
  tool<{ sessionId: string }>({
    name: 'unwatch_session', capability: DRIVE,
    description: 'Stop watching a session.',
    inputSchema: { type: 'object', properties: sessionIdSchema, required: ['sessionId'] },
    parse: (a) => { const id = sessionOf(a); return id === null ? 'sessionId is required.' : { sessionId: id } },
    run: (a, _c, deps) => withDesk(deps, (d) => {
      const s = known(a.sessionId, deps)
      if (typeof s === 'string') return fail(s)
      d.drive.unwatch(s.id)
      return ok(`No longer watching ${s.title}.`)
    }),
  }),
  tool<Record<string, never>>({
    name: 'list_residents', capability: DELEGATE,
    description: 'The other residents (name, kind, state, setup), such as the MR desk.',
    inputSchema: { type: 'object', properties: {} },
    parse: () => ({}),
    run: (_a, call, deps) => withDesk(deps, () => {
      const lines = deps.residents.names().filter((r) => r.id !== call.residentId)
        .map((r) => `- ${r.name} · ${r.kindId} · ${r.state} · ${r.setupNeeded ?? 'set up'}`)
      return ok(lines.length === 0 ? 'No other residents.' : lines.join('\n'))
    }),
  }),
  tool<{ name: string; text: string; taskId: string | null }>({
    name: 'ask_resident', capability: DELEGATE,
    description: 'Send another resident a message. With taskId, its answer comes back to you as a "[Resident event]" for that Slack task.',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, text: { type: 'string' }, ...taskIdSchema }, required: ['name', 'text'] },
    parse: (a) => {
      const name = text(a.name, NAME_MAX)
      const body = text(a.text, DESK_TEXT_MAX)
      const task = optionalTask(a.taskId)
      if (name === null || body === null) return `name and text (1 to ${String(DESK_TEXT_MAX)} characters) are required.`
      return typeof task === 'object' && task !== null ? task.problem : { name, text: body, taskId: task }
    },
    run: (a, call, deps) => delegate(deps, a.taskId, () => deps.residents.ask(call.residentId, a.name, a.text), (n) => `Asked ${n}.`),
  }),
  tool<{ name: string; taskId: string | null }>({
    name: 'run_resident_check', capability: DELEGATE,
    description: 'Make another resident run its check now (the MR desk: check the MRs). With taskId, its answer comes back as a "[Resident event]".',
    inputSchema: { type: 'object', properties: { name: { type: 'string' }, ...taskIdSchema }, required: ['name'] },
    parse: (a) => {
      const name = text(a.name, NAME_MAX)
      const task = optionalTask(a.taskId)
      if (name === null) return 'name is required.'
      return typeof task === 'object' && task !== null ? task.problem : { name, taskId: task }
    },
    run: (a, call, deps) => delegate(deps, a.taskId, () => deps.residents.check(call.residentId, a.name), (n) => `${n} is running its check.`),
  }),
  tool<{ taskId: string; text: string }>({
    name: 'slack_post', capability: SLACK,
    description: 'Post one short message (Markdown) in the Slack task\'s thread, for the owner.',
    inputSchema: { type: 'object', properties: { ...taskIdSchema, text: { type: 'string' } }, required: ['taskId', 'text'] },
    parse: (a) => {
      const task = optionalTask(a.taskId)
      const body = text(a.text, DESK_TEXT_MAX)
      if (typeof task !== 'string') return TASK_HELP
      return body === null ? `text is 1 to ${String(DESK_TEXT_MAX)} characters.` : { taskId: task, text: body }
    },
    run: (a, _c, deps) => withDesk(deps, async (d) => { await d.slack.post(a.taskId, a.text); return ok('Posted.') }),
  }),
  tool<{ taskId: string; summary: string }>({
    name: 'finish_task', capability: SLACK,
    description: 'Post the summary in the thread and close the Slack task: its sessions are no longer watched.',
    inputSchema: { type: 'object', properties: { ...taskIdSchema, summary: { type: 'string' } }, required: ['taskId', 'summary'] },
    parse: (a) => {
      const task = optionalTask(a.taskId)
      const body = text(a.summary, DESK_TEXT_MAX)
      if (typeof task !== 'string') return TASK_HELP
      return body === null ? `summary is 1 to ${String(DESK_TEXT_MAX)} characters.` : { taskId: task, summary: body }
    },
    run: (a, _c, deps) => withDesk(deps, async (d) => { await d.slack.finish(a.taskId, a.summary); return ok('Task finished.') }),
  }),
  tool<Record<string, never>>({
    name: 'list_tasks', capability: SLACK,
    description: 'The open Slack tasks and the sessions being watched.',
    inputSchema: { type: 'object', properties: {} },
    parse: () => ({}),
    run: (_a, _c, deps) => withDesk(deps, (d) => {
      const tasks = d.slack.openTasks()
      const watching = d.drive.watching()
      return ok([
        tasks.length === 0 ? 'No open tasks.' : `Open tasks:\n${tasks.join('\n')}`,
        watching.length === 0 ? 'No watched sessions.' : `Watched sessions:\n${watching.join('\n')}`,
      ].join('\n\n'))
    }),
  }),
]

/** Asks or checks another resident; with a task, that resident then works for it. */
function delegate(deps: ToolDeps, taskId: string | null, act: () => { id: string; name: string }, said: (name: string) => string): Promise<ToolResult> {
  return withDesk(deps, (d) => {
    const other = act()
    if (taskId !== null) d.slack.addResident(taskId, other.id)
    return ok(said(other.name))
  })
}

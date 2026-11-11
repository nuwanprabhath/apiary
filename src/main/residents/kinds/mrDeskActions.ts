import { isRecord } from '@shared/guards'
import type { MrHead, ResidentUserActions, UserAction } from '../kindTypes'

const LINE_MAX = 160

function parseJson(stdout: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** The MR `mra ready` printed (its JSON carries `title`, `target_branch` and `sha`), or null. */
export function mrHeadOf(stdout: string): MrHead | null {
  const parsed = parseJson(stdout)
  if (parsed === null) return null
  const { title, target_branch: targetBranch, sha } = parsed
  return typeof title === 'string' && typeof targetBranch === 'string' && typeof sha === 'string' ? { title, targetBranch, sha } : null
}

const firstLine = (text: string): string => {
  const line = text.replace(/<<<UNTRUSTED[^\n]*\n?|>>>/g, '').trim().split('\n')[0] ?? ''
  return line.length > LINE_MAX ? `${line.slice(0, LINE_MAX - 1)}…` : line
}

const records = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter(isRecord) : [])
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')

function draftsCard(iid: number, title: string, stdout: string): { summary: string } | { problem: string } {
  const parsed = parseJson(stdout)
  if (parsed === null || !Array.isArray(parsed.drafts)) return { problem: 'mra draft list did not list the drafts' }
  const drafts = records(parsed.drafts)
  if (drafts.length === 0) return { problem: `!${String(iid)} has no draft comments to publish` }
  const lines = drafts.map((d) => {
    const where = str(d.file) !== '' ? `${str(d.file)}${str(d.line) !== '' ? `:${str(d.line)}` : ''}` : 'on the MR'
    return `- ${where}${d.outdated === true ? ' (outdated)' : ''}: ${firstLine(str(d.body))}`
  })
  const noun = drafts.length === 1 ? 'draft comment' : 'draft comments'
  return { summary: [`Publish ${String(drafts.length)} ${noun} on !${String(iid)}: ${title}`, ...lines].join('\n') }
}

function threadNotes(stdout: string): { author: string; body: string }[] | null {
  const parsed = parseJson(stdout)
  if (parsed === null || !Array.isArray(parsed.notes)) return null
  return records(parsed.notes).map((n) => ({ author: str(n.author), body: str(n.body) }))
}

function threadCard(action: Extract<UserAction, { discussionId: string }>, title: string, stdout: string): { summary: string } | { problem: string } {
  const notes = threadNotes(stdout)
  const last = notes?.at(-1)
  if (notes === null || last === undefined) return { problem: `mra thread did not show discussion ${action.discussionId}` }
  const quote = (n: { author: string; body: string }): string => `@${n.author}: ${firstLine(n.body)}`
  const iid = String(action.iid)
  if (action.kind === 'reply') {
    return { summary: [`Reply on !${iid}: ${title}`, `Last in the thread: ${quote(last)}`, 'Your reply:', action.body].join('\n') }
  }
  const first = notes[0] ?? last
  return { summary: [`Resolve a thread on !${iid}: ${title}`, `Started by ${quote(first)}`, ...(notes.length > 1 ? [`Last: ${quote(last)}`] : [])].join('\n') }
}

const ref = (iid: number): string => `!${String(iid)}`

/** `request_user_action` for the MR desk: reads through `mra`, writes refused by mra unless the nonce matches. */
export const MR_DESK_USER_ACTIONS: ResidentUserActions = {
  readArgvs: (a) => [
    ['{bin:mra}', 'ready', ref(a.iid)],
    a.kind === 'publish_drafts' ? ['{bin:mra}', 'draft', 'list', ref(a.iid)] : ['{bin:mra}', 'thread', ref(a.iid), '--discussion', a.discussionId],
  ],
  card: (a, [ready = '', facts = '']) => {
    const head = mrHeadOf(ready)
    if (head === null) return { problem: 'mra ready did not give the title' }
    return a.kind === 'publish_drafts' ? draftsCard(a.iid, head.title, facts) : threadCard(a, head.title, facts)
  },
  actArgv: (a, bodyFile) => {
    if (a.kind === 'publish_drafts') return ['{bin:mra}', 'draft', 'publish', ref(a.iid)]
    if (a.kind === 'reply') return ['{bin:mra}', 'reply', ref(a.iid), '--discussion', a.discussionId, '--body-file', bodyFile]
    return ['{bin:mra}', 'resolve', ref(a.iid), a.discussionId]
  },
  bodyFile: (space) => `${space}/mra/state/reply.md`,
  nonceFile: (space) => `${space}/mra/state/action.nonce`,
  nonceEnv: 'MRA_ACTION_NONCE',
}

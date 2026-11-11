import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import { toolsFor } from '../../../src/main/residents/mcp/tools'
import type { ToolDeps, ToolResult } from '../../../src/main/residents/mcp/toolKit'
import { ResidentSpace } from '../../../src/main/residents/residentSpace'
import { at } from '../../contract/must'
import type { ResidentApproval } from '../../../src/main/residents/kindTypes'
import { MR_DESK_USER_ACTIONS } from '../../../src/main/residents/kinds/mrDeskActions'
import type { SessionKnowledge, SessionTopic } from '../../../src/main/knowledge/types'
import type { SessionHit } from '@shared/domain/residents'
import { residentSees, scopeToAccount } from '../../../src/main/app/residentsContainer'

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] }, webContents: { fromId: () => undefined } }))

const SESSION = asSessionId('11111111-2222-3333-4444-555555555555')
const TOPIC: SessionTopic = {
  id: 't1', title: 'Token refresh', summary: 'How the client refreshes its token.', keywords: ['auth'], refs: ['!1175'],
  startLine: 10, endLine: 42,
}

let dir: string
let space: ResidentSpace
let topics: SessionTopic[]
let reads: unknown[]

function deps(over: Partial<ToolDeps> = {}): ToolDeps {
  const knowledge: SessionKnowledge = {
    find: async () => [],
    topics: async () => topics,
    read: async (_id, options) => { reads.push(options); return 'x'.repeat(5000) },
  }
  return {
    knowledge,
    session: (id) => (id === SESSION ? { title: 'API auth' } : null),
    openSession: () => {},
    openTabs: () => [],
    focusedWindow: () => null,
    residents: { statusText: () => '', setAttention: () => {}, setActivity: () => {} },
    ...over,
  }
}

async function call(name: string, args: unknown, d: ToolDeps = deps()): Promise<ToolResult> {
  const tool = toolsFor(['sessions.read', 'workspace.read', 'workspace.open', 'space.notes']).find((t) => t.name === name)
  if (tool === undefined) throw new Error(`no tool ${name}`)
  return tool.call(args, { residentId: 'regent', space }, d)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-tools-'))
  space = new ResidentSpace(dir, 'regent')
  topics = []
  reads = []
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('session_topics', () => {
  it('lists each topic with its lines, summary and refs', async () => {
    topics = [TOPIC]
    const r = await call('session_topics', { sessionId: SESSION })
    expect(r.isError).toBe(false)
    expect(r.text).toBe('## Token refresh (topic t1, lines 10–42)\nHow the client refreshes its token.\nrefs: !1175')
  })

  it('says a session has no digest yet, and refuses an unknown id or a missing index', async () => {
    expect((await call('session_topics', { sessionId: SESSION })).text).toBe('API auth has no digest yet; use read_session.')
    expect((await call('session_topics', { sessionId: 'nope' })).isError).toBe(true)
    expect((await call('session_topics', {})).isError).toBe(true)
    expect((await call('session_topics', { sessionId: SESSION }, deps({ knowledge: null }))).isError).toBe(true)
  })
})

describe('read_session', () => {
  it('passes the topic and query through, and cuts the text at maxChars', async () => {
    const r = await call('read_session', { sessionId: SESSION, topicId: 't1', query: 'refresh', maxChars: 300 })
    expect(r.text).toHaveLength(300)
    expect(reads).toEqual([{ topicId: 't1', query: 'refresh', maxChars: 300 }])
  })

  it('refuses a maxChars out of range and a session it cannot read', async () => {
    expect((await call('read_session', { sessionId: SESSION, maxChars: 10 })).isError).toBe(true)
    const unreadable = deps({ knowledge: { find: async () => [], topics: async () => [], read: async () => null } })
    expect((await call('read_session', { sessionId: SESSION }, unreadable)).text).toBe('Could not read API auth.')
  })
})

describe('list_open_tabs', () => {
  it('groups tabs by window, marks the one in front, and names sessions by title', async () => {
    const d = deps({
      openTabs: () => [
        { windowNumber: 2, key: 'pending-1', view: 'terminal', label: null },
        { windowNumber: 1, key: SESSION, view: 'transcript', label: 'ignored' },
      ],
      focusedWindow: () => 1,
    })
    expect((await call('list_open_tabs', {}, d)).text).toBe(
      `Window 1 (in front):\n- API auth (id: ${SESSION}, transcript)\nWindow 2:\n- New session (terminal)`,
    )
  })

  it('says when nothing is open', async () => {
    expect((await call('list_open_tabs', {})).text).toBe('No tabs are open.')
  })
})

describe('note_list', () => {
  it('lists saved notes, with a long one cut short', async () => {
    expect((await call('note_list', {})).text).toBe('No notes yet.')
    await call('note_put', { key: 'short', text: 'hello' })
    await call('note_put', { key: 'long', text: 'y'.repeat(200) })
    const lines = (await call('note_list', {})).text.split('\n')
    expect(lines).toContain('- short: hello')
    expect(lines.find((l) => l.startsWith('- long: '))).toBe(`- long: ${'y'.repeat(159)}…`)
  })
})

describe('approve_mr', () => {
  const HEAD = { title: 'fix: thing', targetBranch: 'dev/1.0.12', sha: 'abcdef0123456789' }
  const APPROVAL: ResidentApproval = {
    readArgv: (iid) => ['read', String(iid)],
    parseHead: (out) => (out === 'head' ? HEAD : null),
    approveArgv: (iid) => ['approve', String(iid)],
    nonceFile: (s) => join(s, 'state', 'approve.nonce'),
    nonceEnv: 'NONCE',
  }
  interface Ran { argv: string[]; env: Record<string, string>; nonceOnDisk: string | null }

  function approving(allow: boolean, readOut = 'head'): { d: ToolDeps; asked: string[]; ran: Ran[] } {
    const asked: string[] = []
    const ran: Ran[] = []
    const nonceFile = APPROVAL.nonceFile(dir)
    const d = deps({
      approval: {
        approvalOf: () => APPROVAL,
        userActionsOf: () => null,
        askUser: async (_id, _tool, summary) => { asked.push(summary); return allow },
        spaceDir: () => dir,
        run: async (_id, argv, env) => {
          ran.push({ argv, env, nonceOnDisk: existsSync(nonceFile) ? readFileSync(nonceFile, 'utf8') : null })
          if (argv[0] === 'read') return readOut
          return 'approved'
        },
      },
    })
    return { d, asked, ran }
  }
  const approve = async (args: unknown, d: ToolDeps): Promise<ToolResult> => {
    const tool = toolsFor(['gitlab.approve']).find((t) => t.name === 'approve_mr')
    if (tool === undefined) throw new Error('no approve_mr')
    return tool.call(args, { residentId: 'desk', space }, d)
  }
  const approvals = (ran: Ran[]): Ran[] => ran.filter((r) => r.argv[0] === 'approve')

  it('asks the user with a summary main read, and approves nothing when denied', async () => {
    const { d, asked, ran } = approving(false)
    const r = await approve({ iid: 1570 }, d)
    expect(asked).toEqual(['Approve !1570: fix: thing → dev/1.0.12 at abcdef0123'])
    expect(ran.map((x) => x.argv)).toEqual([['read', '1570']])
    expect(r.isError).toBe(true)
  })

  it('approves once when the user allows it, with a one-call nonce on disk and in the env, deleted after', async () => {
    const { d, ran } = approving(true)
    const r = await approve({ iid: 1570 }, d)
    expect(approvals(ran)).toHaveLength(1)
    const run = at(approvals(ran), 0)
    expect(run.argv).toEqual(['approve', '1570'])
    expect(run.env.NONCE).toMatch(/^[0-9a-f]{64}$/)
    expect(run.nonceOnDisk).toBe(run.env.NONCE)
    expect(existsSync(APPROVAL.nonceFile(dir))).toBe(false)
    expect(r).toEqual({ text: 'approved', isError: false })
  })

  it('refuses an iid that is not a positive whole number, without asking', async () => {
    const { d, asked } = approving(true)
    expect((await approve({ iid: '2' }, d)).isError).toBe(true)
    expect((await approve({ iid: 0 }, d)).isError).toBe(true)
    expect(asked).toEqual([])
  })

  it('answers with an error when main cannot read the MR, without asking', async () => {
    const { d, asked, ran } = approving(true, 'garbage')
    expect((await approve({ iid: 5 }, d)).isError).toBe(true)
    expect(asked).toEqual([])
    expect(approvals(ran)).toEqual([])
  })

  it('is listed only for a kind with gitlab.approve, and says so where nothing approves', async () => {
    expect(toolsFor(['sessions.read', 'space.notes']).map((t) => t.name)).not.toContain('approve_mr')
    expect(await approve({ iid: 5 }, deps())).toEqual({ text: 'Approving is not available here.', isError: true })
  })
})

describe('request_user_action (the MR desk)', () => {
  const READY = JSON.stringify({ title: 'fix: thing', target_branch: 'dev', sha: 'abcdef0123456789' })
  const DRAFTS = JSON.stringify({ head_sha: 'abc', drafts: [
    { id: 1, file: 'src/a.ts', line: 12, body: 'Rename this.\nMore.', head_sha: 'abc', outdated: false },
    { id: 2, file: null, line: null, body: 'General point', head_sha: 'abc', outdated: true },
  ] })
  const THREAD = JSON.stringify({ notes: [
    { author: 'me', created_at: 't1', body: '<<<UNTRUSTED note\nWhy is this here?\n>>>' },
    { author: 'dev', created_at: 't2', body: '<<<UNTRUSTED note\nIt is needed for X.\n>>>' },
  ] })
  interface Ran { argv: string[]; env: Record<string, string>; nonceOnDisk: string | null; bodyOnDisk: string | null }

  function acting(allow: boolean, facts: Record<string, string> = {}): { d: ToolDeps; asked: string[]; ran: Ran[] } {
    const asked: string[] = []
    const ran: Ran[] = []
    const nonceFile = MR_DESK_USER_ACTIONS.nonceFile(dir)
    const bodyFile = MR_DESK_USER_ACTIONS.bodyFile(dir)
    const read = (f: string): string | null => (existsSync(f) ? readFileSync(f, 'utf8') : null)
    const out: Record<string, string> = { ready: READY, draft: DRAFTS, thread: THREAD, ...facts }
    const d = deps({
      approval: {
        approvalOf: () => null,
        userActionsOf: () => MR_DESK_USER_ACTIONS,
        askUser: async (_id, _tool, summary) => { asked.push(summary); return allow },
        spaceDir: () => dir,
        run: async (_id, argv, env) => {
          ran.push({ argv, env, nonceOnDisk: read(nonceFile), bodyOnDisk: read(bodyFile) })
          const sub = argv[1] ?? ''
          return sub === 'draft' && argv[2] === 'publish' ? '{"published":2}' : out[sub] ?? '{"ok":true}'
        },
      },
    })
    return { d, asked, ran }
  }
  const act = async (args: unknown, d: ToolDeps): Promise<ToolResult> => {
    const tool = toolsFor(['gitlab.approve']).find((t) => t.name === 'request_user_action')
    if (tool === undefined) throw new Error('no request_user_action')
    return tool.call(args, { residentId: 'desk', space }, d)
  }
  const writes = (ran: Ran[]): Ran[] => ran.filter((r) => r.env.MRA_ACTION_NONCE !== undefined)

  it('shows the drafts main read from mra and publishes them with a one-call nonce, deleted after', async () => {
    const { d, asked, ran } = acting(true)
    const r = await act({ kind: 'publish_drafts', iid: 1669 }, d)
    expect(asked).toEqual([[
      'Publish 2 draft comments on !1669: fix: thing',
      '- src/a.ts:12: Rename this.',
      '- on the MR (outdated): General point',
    ].join('\n')])
    expect(ran.slice(0, 2).map((x) => x.argv)).toEqual([['{bin:mra}', 'ready', '!1669'], ['{bin:mra}', 'draft', 'list', '!1669']])
    const w = at(writes(ran), 0)
    expect(w.argv).toEqual(['{bin:mra}', 'draft', 'publish', '!1669'])
    expect(w.env.MRA_ACTION_NONCE).toMatch(/^[0-9a-f]{64}$/)
    expect(w.nonceOnDisk).toBe(w.env.MRA_ACTION_NONCE)
    expect(existsSync(MR_DESK_USER_ACTIONS.nonceFile(dir))).toBe(false)
    expect(r).toEqual({ text: '{"published":2}', isError: false })
  })

  it('a reply shows the thread\'s last note and the body verbatim, posts it through a body file, and deletes both files', async () => {
    const { d, asked, ran } = acting(true)
    const body = 'Thanks — makes sense.\nResolving.'
    await act({ kind: 'reply', iid: 7, discussionId: 'abc123', body }, d)
    expect(asked).toEqual([['Reply on !7: fix: thing', 'Last in the thread: @dev: It is needed for X.', 'Your reply:', body].join('\n')])
    const w = at(writes(ran), 0)
    expect(w.argv).toEqual(['{bin:mra}', 'reply', '!7', '--discussion', 'abc123', '--body-file', MR_DESK_USER_ACTIONS.bodyFile(dir)])
    expect(w.bodyOnDisk).toBe(body)
    expect(existsSync(MR_DESK_USER_ACTIONS.bodyFile(dir))).toBe(false)
    expect(existsSync(MR_DESK_USER_ACTIONS.nonceFile(dir))).toBe(false)
  })

  it('resolve shows who started the thread and runs mra resolve', async () => {
    const { d, asked, ran } = acting(true)
    await act({ kind: 'resolve', iid: 7, discussionId: 'abc123' }, d)
    expect(at(asked, 0)).toBe(['Resolve a thread on !7: fix: thing', 'Started by @me: Why is this here?', 'Last: @dev: It is needed for X.'].join('\n'))
    expect(at(writes(ran), 0).argv).toEqual(['{bin:mra}', 'resolve', '!7', 'abc123'])
  })

  it('runs nothing when the user declines', async () => {
    const { d, ran } = acting(false)
    const r = await act({ kind: 'reply', iid: 7, discussionId: 'abc123', body: 'hi' }, d)
    expect(r.isError).toBe(true)
    expect(r.text).toContain('declined')
    expect(writes(ran)).toEqual([])
    expect(existsSync(MR_DESK_USER_ACTIONS.bodyFile(dir))).toBe(false)
  })

  it('refuses bad arguments without asking or reading', async () => {
    const { d, asked, ran } = acting(true)
    for (const args of [
      { kind: 'merge', iid: 1 }, { kind: 'publish_drafts', iid: 0 }, { kind: 'reply', iid: 1, body: 'x' },
      { kind: 'reply', iid: 1, discussionId: 'a' }, { kind: 'resolve', iid: 1 }, { kind: 'reply', iid: 1, discussionId: 'a', body: 'x'.repeat(10_001) },
      { kind: 'resolve', iid: 1, discussionId: '../x' },
    ]) expect((await act(args, d)).isError).toBe(true)
    expect(asked).toEqual([])
    expect(ran).toEqual([])
  })

  it('does not ask when there are no drafts or mra cannot be read', async () => {
    const cases: Record<string, string>[] = [{ draft: '{"drafts":[],"head_sha":"a"}' }, { ready: 'garbage' }, { thread: '{"error":"x"}' }]
    for (const facts of cases) {
      const { d, asked } = acting(true, facts)
      expect((await act({ kind: 'publish_drafts', iid: 3 }, d)).isError || (await act({ kind: 'resolve', iid: 3, discussionId: 'a' }, d)).isError).toBe(true)
      expect(asked.length).toBeLessThan(2)
    }
    expect(await act({ kind: 'publish_drafts', iid: 3 }, deps())).toEqual({ text: 'Asking the user to act is not available here.', isError: true })
  })
})

describe('a resident on one account', () => {
  const OTHER = asSessionId('99999999-2222-3333-4444-555555555555')
  const hit = (sessionId: typeof SESSION): SessionHit => ({
    sessionId, title: 't', folder: '/f', branch: null, lastActive: 1, reason: 'title', topic: null, snippet: null,
  })
  const scoped = (): ToolDeps => {
    const base = deps({ session: () => ({ title: 'Some session' }) })
    if (base.knowledge === null) throw new Error('no knowledge')
    const knowledge: SessionKnowledge = { ...base.knowledge, find: async () => [hit(SESSION), hit(OTHER)] }
    return { ...base, ...scopeToAccount({ session: (id) => base.session(id), knowledge }, (id) => id === SESSION) }
  }

  it('cannot read, list topics of or find a session of another account', async () => {
    const read = await call('read_session', { sessionId: OTHER }, scoped())
    expect(read.isError).toBe(true)
    expect(read.text).not.toContain('Some session')
    expect(reads).toEqual([])
    expect((await call('session_topics', { sessionId: OTHER }, scoped())).isError).toBe(true)
    const found = await call('find_sessions', { query: 'x' }, scoped())
    expect(found.text).toContain(SESSION)
    expect(found.text).not.toContain(OTHER)
  })

  it('reads a session of its own account', async () => {
    expect((await call('read_session', { sessionId: SESSION }, scoped())).isError).toBe(false)
  })
})

describe('residentSees', () => {
  it('lets a resident see other accounts only while the setting is on, read on every call', () => {
    let on = false
    const sees = residentSees({ readOtherAccounts: () => on, accountOf: (id) => (id === 'a' ? 'main' : 'work'), defaultId: () => 'main' })
    expect([sees(asSessionId('a')), sees(asSessionId('b'))]).toEqual([true, false])
    on = true
    expect(sees(asSessionId('b'))).toBe(true)
  })
})


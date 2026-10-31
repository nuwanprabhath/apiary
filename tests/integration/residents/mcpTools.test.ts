import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import { toolsFor, type ToolDeps, type ToolResult } from '../../../src/main/residents/mcp/tools'
import { ResidentSpace } from '../../../src/main/residents/residentSpace'
import type { SessionKnowledge, SessionTopic } from '../../../src/main/knowledge/types'

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

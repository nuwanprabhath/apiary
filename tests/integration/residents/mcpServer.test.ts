import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { request } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { asSessionId } from '@shared/domain/ids'
import type { SessionHit } from '@shared/domain/residents'
import { McpServer } from '../../../src/main/residents/mcp/server'
import { ResidentSpace } from '../../../src/main/residents/residentSpace'
import type { ResidentCapability } from '../../../src/main/residents/kinds'
import type { SessionKnowledge } from '../../../src/main/knowledge/types'

const SESSION = asSessionId('11111111-2222-3333-4444-555555555555')
const HIT: SessionHit = {
  sessionId: SESSION, title: 'API auth', folder: 'apiary', branch: 'main', lastActive: 0, reason: 'ref', topic: null, snippet: '!1175',
}
const knowledge: SessionKnowledge = {
  find: async (query) => (query.includes('1175') ? [HIT] : []),
  topics: async () => [],
  read: async () => 'text',
}

interface Reply { status: number; body: string }

function post(url: string, body: string, headers: Record<string, string> = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let text = ''
      res.setEncoding('utf8')
      res.on('data', (c: string) => { text += c })
      res.on('end', () => { resolve({ status: res.statusCode ?? 0, body: text }) })
    })
    req.on('error', reject)
    req.end(body)
  })
}

let dir: string
let server: McpServer
let url: string
let opened: string[]
let controlCalls: unknown[][]
const CAPS: Record<string, readonly ResidentCapability[]> = {
  regent: ['sessions.read', 'workspace.read', 'workspace.open', 'space.notes', 'apiary.status', 'resident.attention'],
  reader: ['sessions.read'],
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-mcp-'))
  opened = []
  controlCalls = []
  server = new McpServer({
    version: '0.0.0',
    capabilitiesOf: (id) => CAPS[id] ?? null,
    spaceOf: (id) => new ResidentSpace(dir, id),
    onToolCall: () => {},
    tools: {
      knowledge,
      session: (id) => (id === SESSION ? { title: 'API auth' } : null),
      openSession: (id) => { opened.push(id) },
      openTabs: () => [],
      focusedWindow: () => null,
      residents: {
        statusText: (id) => `status of ${id}`,
        setAttention: (id, attention) => { controlCalls.push(['attention', id, attention]) },
        setActivity: (id, text) => { controlCalls.push(['activity', id, text]) },
      },
    },
  })
  url = await server.start()
})

afterEach(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

const rpc = (method: string, params: unknown = {}): string => JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
const notify = (method: string): string => JSON.stringify({ jsonrpc: '2.0', method, params: {} })
const as = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}` })
const resultOf = (reply: Reply): Record<string, unknown> => (JSON.parse(reply.body) as { result: Record<string, unknown> }).result

describe('the MCP server', () => {
  it('answers initialize with the client\'s protocol version and a tools capability', async () => {
    const token = server.issueToken('regent')
    const reply = await post(url, rpc('initialize', { protocolVersion: '2025-03-26' }), as(token))
    expect(reply.status).toBe(200)
    expect(resultOf(reply)).toMatchObject({ protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'apiary' } })
  })

  it('rejects a bad token', async () => {
    server.issueToken('regent')
    expect((await post(url, rpc('tools/list'))).status).toBe(401)
    expect((await post(url, rpc('tools/list'), as('f'.repeat(64)))).status).toBe(401)
  })

  it('rejects a foreign Host', async () => {
    const token = server.issueToken('regent')
    const port = new URL(url).port
    expect((await post(url, rpc('tools/list'), { ...as(token), Host: `evil.example:${port}` })).status).toBe(403)
    expect((await post(url, rpc('tools/list'), { ...as(token), Host: `localhost:${port}` })).status).toBe(200)
  })

  it('lists only the kind\'s tools', async () => {
    const all = resultOf(await post(url, rpc('tools/list'), as(server.issueToken('regent')))).tools as { name: string }[]
    expect(all.map((t) => t.name)).toEqual([
      'find_sessions', 'session_topics', 'read_session', 'open_session', 'list_open_tabs', 'note_get', 'note_put', 'note_list',
      'apiary_status', 'set_attention', 'clear_attention', 'set_activity',
    ])
    const some = resultOf(await post(url, rpc('tools/list'), as(server.issueToken('reader')))).tools as { name: string }[]
    expect(some.map((t) => t.name)).toEqual(['find_sessions', 'session_topics', 'read_session'])
  })

  it('calling a tool outside the kind\'s capabilities errors', async () => {
    const reply = await post(url, rpc('tools/call', { name: 'open_session', arguments: { sessionId: SESSION } }), as(server.issueToken('reader')))
    expect((JSON.parse(reply.body) as { error: { code: number } }).error.code).toBe(-32602)
    expect(opened).toEqual([])
  })

  it('find_sessions returns the fake knowledge\'s hits', async () => {
    const reply = await post(url, rpc('tools/call', { name: 'find_sessions', arguments: { query: '!1175' } }), as(server.issueToken('regent')))
    const result = resultOf(reply) as { content: { text: string }[]; isError?: boolean }
    expect(result.isError).toBeUndefined()
    expect(result.content[0].text).toContain(`API auth (id: ${SESSION})`)
  })

  it('open_session with an unknown id is an error result', async () => {
    const token = server.issueToken('regent')
    const unknown = resultOf(await post(url, rpc('tools/call', { name: 'open_session', arguments: { sessionId: 'nope' } }), as(token)))
    expect(unknown).toMatchObject({ isError: true })
    expect(opened).toEqual([])
    const known = resultOf(await post(url, rpc('tools/call', { name: 'open_session', arguments: { sessionId: SESSION } }), as(token)))
    expect(known.isError).toBeUndefined()
    expect(opened).toEqual([SESSION])
  })

  it('notes are kept in the resident\'s own space', async () => {
    const token = server.issueToken('regent')
    await post(url, rpc('tools/call', { name: 'note_put', arguments: { key: 'auth', text: 'the API auth session' } }), as(token))
    const got = resultOf(await post(url, rpc('tools/call', { name: 'note_get', arguments: { key: 'auth' } }), as(token)))
    expect(got).toMatchObject({ content: [{ text: 'the API auth session' }] })
    expect(new ResidentSpace(dir, 'regent').notes()).toEqual({ auth: 'the API auth session' })
  })

  describe('the status and attention tools', () => {
    const call = async (token: string, name: string, args: unknown = {}): Promise<Record<string, unknown>> =>
      resultOf(await post(url, rpc('tools/call', { name, arguments: args }), as(token)))

    it('apiary_status answers the caller\'s own status', async () => {
      expect(await call(server.issueToken('regent'), 'apiary_status')).toMatchObject({ content: [{ text: 'status of regent' }] })
    })

    it('set_attention, clear_attention and set_activity reach the calling resident', async () => {
      const token = server.issueToken('regent')
      await call(token, 'set_attention', { count: 3, summary: ' 3 MRs waiting ' })
      await call(token, 'clear_attention')
      await call(token, 'set_activity', { text: 'Checking   MRs' })
      expect(controlCalls).toEqual([
        ['attention', 'regent', { count: 3, summary: '3 MRs waiting' }], ['attention', 'regent', null], ['activity', 'regent', 'Checking MRs'],
      ])
    })

    it('bad arguments are an error result, and nothing changes', async () => {
      const token = server.issueToken('regent')
      expect(await call(token, 'set_attention', { count: -1, summary: 'x' })).toMatchObject({ isError: true })
      expect(await call(token, 'set_attention', { count: 1, summary: '' })).toMatchObject({ isError: true })
      expect(await call(token, 'set_activity', { text: 5 })).toMatchObject({ isError: true })
      expect(controlCalls).toEqual([])
    })

    it('a kind without the capabilities can neither see nor call them', async () => {
      const token = server.issueToken('reader')
      for (const name of ['apiary_status', 'set_attention', 'clear_attention', 'set_activity']) {
        const reply = await post(url, rpc('tools/call', { name, arguments: { count: 1, summary: 'x', text: 'x' } }), as(token))
        expect((JSON.parse(reply.body) as { error: { code: number } }).error.code).toBe(-32602)
      }
      expect(controlCalls).toEqual([])
    })
  })

  it('notifications get 202', async () => {
    const reply = await post(url, notify('notifications/initialized'),as(server.issueToken('regent')))
    expect(reply).toEqual({ status: 202, body: '' })
  })

  it('a GET gets 405', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      request(url, { method: 'GET' }, (res) => { res.resume(); resolve(res.statusCode ?? 0) }).on('error', reject).end()
    })
    expect(status).toBe(405)
  })

  it('a 2 MB body is refused', async () => {
    const big = rpc('tools/call', { name: 'note_put', arguments: { key: 'k', text: 'x'.repeat(2 * 1024 * 1024) } })
    expect((await post(url, big, as(server.issueToken('regent')))).status).toBe(413)
  })
})

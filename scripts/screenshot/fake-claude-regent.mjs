#!/usr/bin/env node
// A stand-in for a resident's `claude` in the README's Regent picture. Like
// tests/fixtures/fake-claude-resident.mjs it speaks real MCP to Apiary with the bearer token from
// `--mcp-config`, so what the picture shows (a session opened, a badge flag raised) really went
// through Apiary's tools. Three scripted turns: "Open the session for !1175", the auth question,
// and the MR desk's "Run one MR desk cycle".
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const sessionId = flag('--resume') ?? randomUUID()
const out = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const config = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8')).mcpServers.apiary
let rpcId = 0
async function rpc(method, params, notification = false) {
  const body = notification ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++rpcId, method, params }
  const res = await fetch(config.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...config.headers },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${method} answered HTTP ${String(res.status)}`)
  if (notification) return null
  const reply = await res.json()
  if (reply.error) throw new Error(`${method}: ${reply.error.message}`)
  return reply.result
}
async function callTool(name, input) {
  const result = await rpc('tools/call', { name, arguments: input })
  const text = (result.content ?? []).map((c) => c.text ?? '').join('\n')
  if (result.isError) throw new Error(`${name}: ${text}`)
  return text
}
const assistant = (content) => out({ type: 'assistant', uuid: randomUUID(), session_id: sessionId, message: { role: 'assistant', content } })
const toolUse = (name, input) => assistant([{ type: 'tool_use', id: `toolu_${randomUUID()}`, name: `mcp__apiary__${name}`, input }])
const use = async (name, input) => { toolUse(name, input); return callTool(name, input) }

async function stream(text) {
  out({ type: 'stream_event', event: { type: 'message_start' } })
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } })
  for (const word of text.split(/(?<= )/)) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } } })
    await sleep(8)
  }
  assistant([{ type: 'text', text }])
}

const link = (title, id) => `[${title}](apiary://session/${id})`
const idsIn = (found) => [...found.matchAll(/\(id: ([0-9a-f-]{36})\)/g)].map((m) => m[1])
const titleOf = (found, id) => new RegExp(`^- (.+?) \\(id: ${id}\\)`, 'm').exec(found)?.[1] ?? 'session'

async function turn(question) {
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fake-claude', version: '2.1.302' } })
  await rpc('notifications/initialized', undefined, true)
  if (/MR desk cycle/.test(question)) {
    await use('set_activity', { text: 'Checking your MRs' })
    await sleep(2500) // the cycle takes a while, long enough for the spec to close the desk's chat first
    await use('set_attention', { count: 2, summary: '2 MRs ready to approve' })
    await stream('Two of your MRs are ready to approve: !1175 and !1182. Nothing else is waiting.')
    return
  }
  if (/auth/i.test(question)) {
    await use('set_activity', { text: 'Reading API auth design' })
    const found = await use('find_sessions', { query: 'service token auth' })
    // The design first, then the rollout it led to.
    const designFirst = (id) => (titleOf(found, id).startsWith('Design') ? 0 : 1)
    const [first, second] = idsIn(found).sort((a, b) => designFirst(a) - designFirst(b))
    if (second === undefined) throw new Error(`find_sessions matched fewer than two: ${found}`)
    await stream([
      `Core issues short-lived tokens and wildobs only verifies them, as designed in ${link(titleOf(found, first), first)} and rolled out in ${link(titleOf(found, second), second)}.`,
      '',
      '- Core signs a 15-minute token per service; wildobs checks the signature and never stores credentials.',
      '- Refresh happens in core only, so a revoked service stops within one token lifetime.',
      '- Key rotation is the open question.',
    ].join('\n'))
    return
  }
  await use('set_activity', { text: 'Searching sessions' })
  const found = await use('find_sessions', { query: question })
  const [id] = idsIn(found)
  if (id === undefined) throw new Error(`find_sessions matched nothing: ${found}`)
  await use('open_session', { sessionId: id })
  await stream(`Opened it for you: ${link(titleOf(found, id), id)}`)
}

async function answer(question) {
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-fake-1' })
  try { await turn(question) } catch (e) { await stream(`MCP FAILED: ${e instanceof Error ? e.message : String(e)}`) }
  out({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false })
}

let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.type !== 'user') return
  const content = msg.message?.content
  const text = typeof content === 'string' ? content : (content ?? []).map((c) => c.text ?? '').join('')
  queue = queue.then(() => answer(text))
})

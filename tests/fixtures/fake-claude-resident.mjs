#!/usr/bin/env node
// A stand-in for a resident's `claude` (stream-json, claude 2.1.302): it reads the URL and bearer
// token from the file `--mcp-config` names and really calls Apiary's MCP server over HTTP, as
// claude does, so an e2e spec proves the token, the server and the open-session round trip.
// A failed call streams "MCP FAILED: <reason>" so a spec fails visibly instead of timing out.
//
// By default, per user message: initialize, notifications/initialized, tools/list, find_sessions
// with the message, open_session with the first id found, then an answer citing that session.
//
// Scripted turns: when FAKE_RESIDENT_SCENARIOS names a JSON file (the spec's wrapper sets it),
// that file is `{ "path": "<dirs put first on PATH for commands>", "scenarios": { "<start>": [step] } }`
// and a message starting with `<start>` runs its steps in order instead. The file is read per
// message, so a spec can change it between turns. A step is one of:
//   { "tool": "Bash", "command": "mra poll", "run": true }  a tool_use line; `run` really runs it
//   { "tool": "Agent", "description": "…" } / { "tool": "WebSearch", "query": "…" }
//   { "mcp": "set_attention", "args": { … } }               a real call to Apiary's MCP server
//   { "ask": { "tool": "Bash", "command": "…" } }            a can_use_tool request; waits for the answer
//   { "text": "…" }                                          streamed text ({decision} is the last answer)
// and any step may carry "until": "<name>", which holds after it (a text holds after its first word)
// until the file `<scenario dir>/release-<name>` exists, so a spec can observe each state.
import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const sessionId = flag('--resume') ?? randomUUID()
const out = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const scenarioFile = process.env.FAKE_RESIDENT_SCENARIOS

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
const rawToolUse = (name, input) => assistant([{ type: 'tool_use', id: `toolu_${randomUUID()}`, name, input }])
const toolUse = (name, input) => rawToolUse(`mcp__apiary__${name}`, input)

async function release(name) {
  if (name === undefined) return
  const file = join(dirname(scenarioFile), `release-${name}`)
  while (!existsSync(file)) await sleep(50)
}

async function stream(text, until) {
  out({ type: 'stream_event', event: { type: 'message_start' } })
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } })
  const words = text.split(/(?<= )/)
  for (const [i, word] of words.entries()) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } } })
    if (i === 0) await release(until)
    await sleep(15)
  }
  assistant([{ type: 'text', text }])
}

async function connect() {
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'fake-claude', version: '2.1.302' } })
  await rpc('notifications/initialized', undefined, true)
  await rpc('tools/list', {})
}

async function regentAnswer(question) {
  toolUse('find_sessions', { query: question })
  const found = await callTool('find_sessions', { query: question })
  const hit = /^- (.+?) \(id: ([0-9a-f-]{36})\)/m.exec(found)
  if (hit === null) throw new Error(`find_sessions matched nothing: ${found}`)
  toolUse('open_session', { sessionId: hit[2] })
  await callTool('open_session', { sessionId: hit[2] })
  await stream(`Opened it for you: [${hit[1]}](apiary://session/${hit[2]})`)
}

/** Permission answers from Apiary, by request id. */
const answers = new Map()
function ask(tool, input) {
  const requestId = randomUUID()
  out({ type: 'control_request', request_id: requestId, request: { subtype: 'can_use_tool', tool_name: tool, input } })
  return new Promise((resolve) => { answers.set(requestId, resolve) })
}

async function runScript(script, steps) {
  let decision = 'none'
  for (const step of steps) {
    if (step.tool === 'Bash') {
      rawToolUse('Bash', { command: step.command })
      if (step.run === true) {
        const env = { ...process.env, PATH: [script.path, process.env.PATH].filter(Boolean).join(':') }
        try { execSync(step.command, { env, stdio: 'ignore', timeout: 60_000 }) } catch { /* a failed command is the scenario's to judge */ }
      }
    } else if (step.tool === 'Agent') rawToolUse('Agent', { description: step.description, prompt: step.description })
    else if (step.tool === 'WebSearch') rawToolUse('WebSearch', { query: step.query })
    else if (step.mcp !== undefined) {
      toolUse(step.mcp, step.args ?? {})
      await callTool(step.mcp, step.args ?? {})
    } else if (step.ask !== undefined) {
      const reply = await ask(step.ask.tool, { command: step.ask.command })
      decision = reply?.behavior === 'allow' ? 'allowed' : 'denied'
    }
    if (step.text !== undefined) await stream(step.text.replace('{decision}', decision), step.until)
    else await release(step.until)
  }
}

async function answer(question) {
  out({ type: 'system', subtype: 'init', session_id: sessionId, model: 'claude-fake-1' })
  try {
    await connect()
    const script = scenarioFile === undefined ? null : JSON.parse(readFileSync(scenarioFile, 'utf8'))
    const key = Object.keys(script?.scenarios ?? {}).find((k) => question.startsWith(k))
    if (key === undefined) await regentAnswer(question)
    else await runScript(script, script.scenarios[key])
  } catch (e) {
    await stream(`MCP FAILED: ${e instanceof Error ? e.message : String(e)}`)
  }
  out({ type: 'result', subtype: 'success', session_id: sessionId, is_error: false })
}

let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.type === 'control_response') {
    const id = msg.response?.request_id
    answers.get(id)?.(msg.response?.response)
    answers.delete(id)
    return
  }
  if (msg.type !== 'user') return
  const content = msg.message?.content
  const text = typeof content === 'string' ? content : (content ?? []).map((c) => c.text ?? '').join('')
  queue = queue.then(() => answer(text))
})

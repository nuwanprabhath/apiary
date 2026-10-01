#!/usr/bin/env node
// A stand-in for `claude` in chat mode (`--input-format/--output-format stream-json`), speaking the
// protocol main/chat/protocol.ts documents, measured from claude 2.1.286. For integration and e2e
// tests only — never real tokens.
//
// Per user message it streams a reply, word by word. A message containing "permission" first asks
// to run a Bash command and waits for the answer; "slow" streams long enough to be interrupted.
// The session id comes from `--resume <id>`.
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
let sessionId = args[args.indexOf('--resume') + 1] ?? randomUUID()
// After /clear the new session is written to its own JSONL, as claude writes it, so Apiary can
// index it and a tab can follow the chat there (sessions before it are the fixture's, not ours).
let cleared = false
const ROOT = process.env.APIARY_CONFIG_ROOT || process.env.CLAUDE_CONFIG_DIR || ''
function persist(o) {
  if (!cleared || ROOT === '' || (o.type !== 'user' && o.type !== 'assistant')) return
  const dir = join(ROOT, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/g, '-'))
  mkdirSync(dir, { recursive: true })
  const line = { ...o, cwd: process.cwd(), sessionId, isSidechain: false, version: '2.1.286', timestamp: o.timestamp ?? new Date().toISOString() }
  appendFileSync(join(dir, `${sessionId}.jsonl`), `${JSON.stringify(line)}\n`)
}
const out = (o) => { process.stdout.write(`${JSON.stringify(o)}\n`); persist(o) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let initialised = false
let interrupted = false
let mode = args.includes('--permission-mode') ? args[args.indexOf('--permission-mode') + 1] : 'default'
const waiting = new Map()
const MODELS = [
  { value: 'default', resolvedModel: 'claude-fake-1', displayName: 'Default (recommended)', description: 'Fake 1 · for tests', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'claude-fake-1', resolvedModel: 'claude-fake-1', displayName: 'Fake 1', description: 'The default', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'fast', resolvedModel: 'claude-fast-2', displayName: 'Fast 2', description: 'Fastest for quick answers' },
]
let model = args.includes('--model') ? (MODELS.find((m) => m.value === args[args.indexOf('--model') + 1])?.resolvedModel ?? 'claude-fake-1') : 'claude-fake-1'
let effort = args.includes('--effort') ? args[args.indexOf('--effort') + 1] : 'medium'

const assistant = (content) => out({
  type: 'assistant', uuid: randomUUID(), session_id: sessionId, timestamp: new Date().toISOString(),
  message: { role: 'assistant', content, usage: { input_tokens: 10, cache_read_input_tokens: 4000, cache_creation_input_tokens: 0 } },
})

async function stream(text) {
  out({ type: 'stream_event', event: { type: 'message_start' } })
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'thinking' } } })
  out({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 120 })
  await sleep(50)
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } })
  for (const word of text.split(/(?<= )/)) {
    if (interrupted) return false
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } } })
    await sleep(text.length > 200 ? 40 : 15)
  }
  assistant([{ type: 'text', text }])
  return true
}

async function turn(text) {
  interrupted = false
  // As claude does: /clear starts a new conversation under a new session id, in the same process;
  // a local command answers with a synthetic message and no user message is replayed.
  if (text === '/clear') {
    sessionId = randomUUID()
    cleared = true
    out({ type: 'system', subtype: 'init', session_id: sessionId, model, permissionMode: mode })
    out({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, modelUsage: {} })
    return
  }
  if (text === '/context') {
    assistant([{ type: 'text', text: '## Context Usage\n\n**Tokens:** 4k / 200k (2%)' }])
    out({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, modelUsage: {} })
    return
  }
  if (!initialised) {
    initialised = true
    out({ type: 'system', subtype: 'init', session_id: sessionId, model, permissionMode: mode })
  }
  out({ type: 'user', uuid: randomUUID(), session_id: sessionId, message: { role: 'user', content: [{ type: 'text', text }] } })
  if (text.includes('permission')) {
    const toolUseId = `toolu_${randomUUID()}`
    const input = { command: 'echo fake-ran', description: 'Print a marker' }
    assistant([{ type: 'tool_use', id: toolUseId, name: 'Bash', input }])
    const requestId = randomUUID()
    out({
      type: 'control_request', request_id: requestId,
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input, description: 'Print a marker', tool_use_id: toolUseId,
        permission_suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'session' }] },
    })
    const answer = await new Promise((resolve) => waiting.set(requestId, resolve))
    const allowed = answer.behavior === 'allow'
    out({
      type: 'user', uuid: randomUUID(), session_id: sessionId,
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content: allowed ? 'fake-ran' : answer.message, is_error: !allowed }] },
    })
    await stream(allowed ? 'The command ran.' : 'Understood, I did not run it.')
  } else {
    const reply = text.includes('slow')
      ? Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
      : `You said: ${text}`
    const finished = await stream(reply)
    if (!finished) {
      out({ type: 'user', uuid: randomUUID(), session_id: sessionId, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } })
      out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sessionId, modelUsage: {} })
      return
    }
  }
  out({ type: 'result', subtype: 'success', is_error: false, session_id: sessionId, modelUsage: { 'claude-fake-1': { contextWindow: 200000 } } })
}

// As the real claude does: SIGTERM ends it with exit code 143, not death by the signal.
process.on('SIGTERM', () => { process.exit(143) })

let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.type === 'user') {
    const text = msg.message.content.map((b) => b.text ?? '').join('')
    queue = queue.then(() => turn(text))
  } else if (msg.type === 'control_request') {
    const req = msg.request
    let response = {}
    if (req.subtype === 'interrupt') interrupted = true
    if (req.subtype === 'set_permission_mode') mode = req.mode
    if (req.subtype === 'set_model') model = MODELS.find((m) => m.value === req.model)?.resolvedModel ?? req.model
    if (req.subtype === 'apply_flag_settings' && req.settings?.effortLevel) effort = req.settings.effortLevel
    if (req.subtype === 'initialize') {
      response = {
        models: MODELS,
        current_permission_mode: mode,
        commands: [
          { name: 'clear', description: 'Clear conversation history and free up context', argumentHint: '' },
          { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>' },
          { name: 'context', description: 'Show current context usage', argumentHint: '' },
        ],
      }
    }
    if (req.subtype === 'get_settings') response = { effective: { effortLevel: effort }, applied: { model, effort: null } }
    out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response } })
  } else if (msg.type === 'control_response') {
    waiting.get(msg.response.request_id)?.(msg.response.response)
    waiting.delete(msg.response.request_id)
  }
// Like the real one, it takes a moment to shut down after stdin closes — long enough that a
// SIGTERM sent right after arrives first.
}).on('close', () => { void queue.then(() => sleep(300)).then(() => process.exit(0)) })

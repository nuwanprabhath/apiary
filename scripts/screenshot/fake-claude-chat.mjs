#!/usr/bin/env node
// A stand-in for `claude` in chat mode, used only by `npm run screenshot` (see fake-claude.sh, which
// hands over to this when it is started with `--input-format stream-json`). It speaks the protocol
// tests/fixtures/fake-claude-chat.mjs does, but plays one scripted turn per project folder, so the
// README's chat panes show a believable moment of real work: no network, no tokens.
//
// billing-api: Claude is partway through a long task — it streams a reply, starts a command and
//   never finishes it, so the pane shows a pending tool call and the working line counting up.
// web-app: Claude answers, then asks the person a single question (AskUserQuestion) and waits.
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'
import { basename } from 'node:path'

const args = process.argv.slice(2)
const sessionId = args[args.indexOf('--resume') + 1] ?? randomUUID()
const project = basename(process.cwd())
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const MODEL = 'claude-sonnet-5-5'
const MODELS = [
  { value: 'default', resolvedModel: MODEL, displayName: 'Default (recommended)', description: 'Sonnet 5.5 · best for everyday tasks', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'] },
  { value: 'opus', resolvedModel: 'claude-opus-5-5', displayName: 'Opus 5.5', description: 'Most capable for complex work', supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'] },
  { value: 'haiku', resolvedModel: 'claude-haiku-5-5', displayName: 'Haiku 5.5', description: 'Fastest for quick answers' },
]
const COMMANDS = [
  { name: 'clear', description: 'Clear conversation history and free up context', argumentHint: '' },
  { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>' },
  { name: 'context', description: 'Show current context usage', argumentHint: '' },
  { name: 'review', description: 'Review a pull request', argumentHint: '' },
  { name: 'security-review', description: 'Complete a security review of the pending changes on the current branch', argumentHint: '' },
  { name: 'init', description: 'Initialize a new CLAUDE.md file with codebase documentation', argumentHint: '' },
]

const assistant = (content) => out({
  type: 'assistant', uuid: randomUUID(), session_id: sessionId, timestamp: new Date().toISOString(),
  message: { role: 'assistant', content, usage: { input_tokens: 10, cache_read_input_tokens: 38000, cache_creation_input_tokens: 0 } },
})
const replay = (text) => out({
  type: 'user', uuid: randomUUID(), session_id: sessionId, isReplay: true, timestamp: new Date().toISOString(),
  message: { role: 'user', content: [{ type: 'text', text }] },
})

async function streamText(text) {
  out({ type: 'stream_event', event: { type: 'message_start' } })
  out({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'text', text: '' } } })
  for (const word of text.split(/(?<= )/)) {
    out({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: word } } })
    await sleep(25)
  }
  assistant([{ type: 'text', text }])
}

const waiting = new Map()

const SCRIPTS = {
  'billing-api': async () => {
    await streamText('Both fixes are in. I’ll run the whole suite and the linter now, since the `claim()` change touches the shared fake used by the other webhook tests.')
    assistant([{ type: 'tool_use', id: `toolu_${randomUUID()}`, name: 'Bash', input: { command: 'npm run lint && npm test', description: 'Run the linter and the full test suite' } }])
    // The command never reports back: the pane stays mid-turn, with the working line counting up.
    await new Promise(() => {})
  },
  'web-app': async () => {
    await streamText('Understood: follow the system setting by default, with a manual override. Before I touch the settings page, one decision I would rather not guess at.')
    const toolUseId = `toolu_${randomUUID()}`
    const input = {
      questions: [{
        question: 'Where should the theme preference be stored?',
        header: 'Storage',
        multiSelect: false,
        options: [
          { label: 'localStorage', description: 'Per browser. Works signed out, but stays on one device.' },
          { label: 'User profile', description: 'Saved with the account, so it follows them everywhere.' },
        ],
      }],
    }
    assistant([{ type: 'tool_use', id: toolUseId, name: 'AskUserQuestion', input }])
    const requestId = randomUUID()
    out({
      type: 'control_request', request_id: requestId,
      request: { subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input, tool_use_id: toolUseId },
    })
    await new Promise((resolve) => waiting.set(requestId, resolve))
  },
}

let initialised = false
let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg
  try { msg = JSON.parse(line) } catch { return }
  if (msg.type === 'user') {
    const text = msg.message.content.map((b) => b.text ?? '').join('')
    queue = queue.then(async () => {
      if (!initialised) {
        initialised = true
        out({ type: 'system', subtype: 'init', session_id: sessionId, model: MODEL, permissionMode: 'default' })
      }
      replay(text)
      await (SCRIPTS[project] ?? (() => streamText('Done.')))()
    })
  } else if (msg.type === 'control_request') {
    let response = {}
    if (msg.request.subtype === 'initialize') response = { models: MODELS, commands: COMMANDS, current_permission_mode: 'default' }
    if (msg.request.subtype === 'get_settings') response = { effective: { effortLevel: 'high' }, applied: { model: MODEL, effort: null } }
    if (msg.request.subtype === 'get_context_usage') response = { totalTokens: 61200, maxTokens: 200000, rawMaxTokens: 200000, percentage: 31, categories: [] }
    out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response } })
  } else if (msg.type === 'control_response') {
    waiting.get(msg.response.request_id)?.(msg.response.response)
    waiting.delete(msg.response.request_id)
  }
}).on('close', () => { process.exit(0) })

process.on('SIGTERM', () => { process.exit(143) })

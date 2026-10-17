#!/usr/bin/env node
// A stand-in for `claude` in chat mode that plays back recordings made by `record-claude.mjs`, at
// their recorded pace, so the load benchmark can repeat a real Haiku workload without tokens (and on
// a machine with no `claude` login, such as the Linux container).
//
// $APIARY_BENCH_REPLAY is a recording file or a folder of them (`.jsonl` or `.jsonl.gz`); a session picks one by its id, so
// six sessions replay six different recordings when there are six. Every user message replays the
// next recorded turn (the lines between a user message and its `result`), with the session id and
// message uuids rewritten. As claude does, user and assistant messages are appended to the session's
// JSONL under $APIARY_CONFIG_ROOT, so Apiary's watcher and transcript see the same file traffic.
import { randomUUID, createHash } from 'node:crypto'
import { appendFileSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const sessionId = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : randomUUID()
const source = process.env.APIARY_BENCH_REPLAY ?? ''
const files = statSync(source).isDirectory()
  ? readdirSync(source).filter((f) => /\.jsonl(\.gz)?$/.test(f)).sort().map((f) => join(source, f))
  : [source]
const pick = parseInt(createHash('sha1').update(sessionId).digest('hex').slice(0, 8), 16) % files.length
const raw = readFileSync(files[pick])
const recording = (files[pick].endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const parse = (line) => { try { return JSON.parse(line) } catch { return null } }

// Recorded answers to control requests, by subtype.
const answers = new Map()
const subtypeOf = new Map()
for (const r of recording) {
  const m = parse(r.line)
  if (m?.type === 'control_request' && r.d === 'in') subtypeOf.set(m.request_id, m.request?.subtype)
  if (m?.type === 'control_response' && r.d === 'out') {
    const subtype = subtypeOf.get(m.response?.request_id)
    if (subtype !== undefined && !answers.has(subtype)) answers.set(subtype, m.response.response ?? {})
  }
}

// Turns: the output lines after each recorded user message, up to and including its `result`.
const turns = []
let current = null
for (const r of recording) {
  const m = parse(r.line)
  if (m === null) continue
  if (r.d === 'in' && m.type === 'user') { current = { start: r.t, lines: [] }; turns.push(current); continue }
  if (r.d !== 'out' || current === null || m.type === 'control_response' || m.type === 'control_request') continue
  current.lines.push({ at: r.t - current.start, m })
  if (m.type === 'result') current = null
}
if (turns.length === 0) { console.error(`replay-claude-chat: no turns in ${files[pick]}`); process.exit(2) }

const root = process.env.APIARY_CONFIG_ROOT || process.env.CLAUDE_CONFIG_DIR || ''
function sessionFile() {
  if (root === '') return null
  const projects = join(root, 'projects')
  if (!existsSync(projects)) return null
  for (const d of readdirSync(projects)) {
    const f = join(projects, d, `${sessionId}.jsonl`)
    if (existsSync(f)) return f
  }
  return null
}
const file = sessionFile()
let parentUuid = null
function persist(m) {
  if (file === null || (m.type !== 'user' && m.type !== 'assistant')) return
  const line = { parentUuid, isSidechain: false, type: m.type, message: m.message, uuid: m.uuid, timestamp: new Date().toISOString(), cwd: process.cwd(), sessionId, version: '2.1.300' }
  parentUuid = m.uuid
  appendFileSync(file, `${JSON.stringify(line)}\n`)
}
const out = (m) => { process.stdout.write(`${JSON.stringify(m)}\n`); persist(m) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let next = parseInt(sessionId.replace(/-/g, '').slice(-4), 16) % turns.length
let interrupted = false
async function turn(text) {
  interrupted = false
  const userUuid = randomUUID()
  out({ type: 'user', uuid: userUuid, session_id: sessionId, isReplay: true, timestamp: new Date().toISOString(), message: { role: 'user', content: [{ type: 'text', text }] } })
  const t = turns[next]
  next = (next + 1) % turns.length
  const uuids = new Map()
  const began = Date.now()
  for (const { at, m } of t.lines) {
    // Recorded tool waits longer than 10 s are cut short: the benchmark measures Apiary, not the tools.
    const wait = Math.min(at, (Date.now() - began) + 10_000) - (Date.now() - began)
    if (wait > 0) await sleep(wait)
    if (interrupted) break
    const copy = structuredClone(m)
    if ('session_id' in copy) copy.session_id = sessionId
    if (typeof copy.uuid === 'string') {
      if (!uuids.has(copy.uuid)) uuids.set(copy.uuid, randomUUID())
      copy.uuid = uuids.get(copy.uuid)
    }
    if (copy.type === 'user' && copy.isReplay) continue
    out(copy)
  }
  if (interrupted) out({ type: 'result', subtype: 'error_during_execution', is_error: true, session_id: sessionId, modelUsage: {} })
}

process.on('SIGTERM', () => { process.exit(143) })
let queue = Promise.resolve()
createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = parse(line)
  if (msg === null) return
  if (msg.type === 'user') {
    const text = (msg.message?.content ?? []).map((b) => b.text ?? '').join('')
    queue = queue.then(() => turn(text))
  } else if (msg.type === 'control_request') {
    const subtype = msg.request?.subtype
    if (subtype === 'interrupt') interrupted = true
    out({ type: 'control_response', response: { subtype: 'success', request_id: msg.request_id, response: answers.get(subtype) ?? {} } })
  }
}).on('close', () => { void queue.then(() => process.exit(0)) })

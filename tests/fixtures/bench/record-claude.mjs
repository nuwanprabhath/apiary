#!/usr/bin/env node
// Runs the real `claude` (Haiku unless APIARY_BENCH_MODEL says otherwise) for the load benchmark and
// records every stream-json line both ways, with its time, to $APIARY_BENCH_RECORD/<time>-<pid>.jsonl.
// `replay-claude-chat.mjs` plays a recording back, so a benchmark can be repeated without tokens.
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const dir = process.env.APIARY_BENCH_RECORD
if (!dir) { console.error('record-claude: APIARY_BENCH_RECORD is not set'); process.exit(2) }
mkdirSync(dir, { recursive: true })
const file = join(dir, `${Date.now()}-${process.pid}.jsonl`)
const start = Date.now()
const log = (d, line) => { appendFileSync(file, `${JSON.stringify({ t: Date.now() - start, d, line })}\n`) }

const child = spawn('claude', ['--model', process.env.APIARY_BENCH_MODEL || 'haiku', ...process.argv.slice(2)], { stdio: ['pipe', 'pipe', 'inherit'] })
createInterface({ input: process.stdin }).on('line', (line) => { log('in', line); child.stdin.write(`${line}\n`) }).on('close', () => { child.stdin.end() })
createInterface({ input: child.stdout }).on('line', (line) => { log('out', line); process.stdout.write(`${line}\n`) })
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { child.kill(sig) })
child.on('exit', (code, signal) => { process.exit(code ?? (signal === 'SIGTERM' ? 143 : 1)) })

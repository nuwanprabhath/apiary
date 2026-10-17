#!/usr/bin/env node
/**
 * What a Chromium trace from the load benchmark (`APIARY_BENCH_TRACE=1`, `trace.json`) spent its
 * time on: for each busy thread, how busy it was and the events with the most self time (the time
 * an event ran minus the events nested in it), so "(program)" in a CPU profile gets a name —
 * style, layout, paint, raster, IPC.
 *
 *     node scripts/bench/trace-summary.mjs <trace.json> [threads=8] [events=12]
 */
import { readFileSync } from 'node:fs'

const [file, threadLimit = '8', eventLimit = '12'] = process.argv.slice(2)
if (file === undefined) {
  console.error('usage: trace-summary.mjs <trace.json> [threads] [events]')
  process.exit(2)
}
const raw = JSON.parse(readFileSync(file, 'utf8'))
const events = Array.isArray(raw) ? raw : raw.traceEvents

const processName = new Map()
const threadName = new Map()
for (const e of events) {
  if (e.ph !== 'M') continue
  if (e.name === 'process_name') processName.set(e.pid, e.args.name)
  if (e.name === 'thread_name') threadName.set(`${e.pid}:${e.tid}`, e.args.name)
}

// Complete events per thread; B/E pairs become complete events.
const byThread = new Map()
const open = new Map()
let first = Infinity
let last = -Infinity
for (const e of events) {
  if (typeof e.ts !== 'number') continue
  const key = `${e.pid}:${e.tid}`
  let span = null
  if (e.ph === 'X' && typeof e.dur === 'number') span = { name: e.name, ts: e.ts, dur: e.dur }
  else if (e.ph === 'B') { const stack = open.get(key) ?? []; stack.push(e); open.set(key, stack) }
  else if (e.ph === 'E') { const b = open.get(key)?.pop(); if (b !== undefined) span = { name: b.name, ts: b.ts, dur: e.ts - b.ts } }
  if (span === null) continue
  first = Math.min(first, span.ts)
  last = Math.max(last, span.ts + span.dur)
  const list = byThread.get(key) ?? []
  list.push(span)
  byThread.set(key, list)
}
const wall = (last - first) / 1000

const rows = []
for (const [key, spans] of byThread) {
  spans.sort((a, b) => a.ts - b.ts || b.dur - a.dur)
  const stack = []
  const self = new Map()
  let busy = 0
  for (const s of spans) {
    while (stack.length > 0 && stack.at(-1).ts + stack.at(-1).dur <= s.ts) stack.pop()
    const parent = stack.at(-1)
    if (parent === undefined) busy += s.dur
    else parent.child = (parent.child ?? 0) + s.dur
    stack.push(s)
  }
  for (const s of spans) self.set(s.name, (self.get(s.name) ?? 0) + Math.max(0, s.dur - (s.child ?? 0)))
  const [pid] = key.split(':')
  rows.push({
    thread: `${processName.get(Number(pid)) ?? pid} / ${threadName.get(key) ?? key}`,
    busyMs: Math.round(busy / 1000),
    busyPct: Math.round((busy / 1000 / wall) * 1000) / 10,
    top: [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number(eventLimit)).map(([n, us]) => `${n} ${String(Math.round(us / 1000))}ms`),
  })
}
rows.sort((a, b) => b.busyMs - a.busyMs)
console.log(`trace: ${String(Math.round(wall))} ms of wall time`)
for (const r of rows.slice(0, Number(threadLimit))) {
  console.log(`\n${r.thread}: busy ${String(r.busyMs)} ms (${String(r.busyPct)}%)`)
  for (const t of r.top) console.log(`  ${t}`)
}

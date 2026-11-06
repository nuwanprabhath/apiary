#!/usr/bin/env node
// Before and after, from two `measure.mjs` runs on the same machine:
//
//   node .claude/skills/prune-tests/compare.mjs before after
//
// Prints a Markdown table per layer (wall time, tests, files, lines of test code) and coverage, and
// writes it to `.agent-reports/test-stats/<after>/compare.md`.
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const [a, b] = process.argv.slice(2)
if (!a || !b) { console.error('usage: compare.mjs <before label> <after label>'); process.exit(2) }
const dir = (l) => join(process.cwd(), '.agent-reports', 'test-stats', l)
const load = (l) => JSON.parse(readFileSync(join(dir(l), 'summary.json'), 'utf8'))
const A = load(a); const B = load(b)

/** Lines in a layer's test files at a commit (`git show`), or in the working tree for a run measured on uncommitted changes. */
function testLines(summary, layer) {
  const ext = layer === 'e2e' ? '.spec.ts' : layer === 'component' ? '.test.tsx' : '.test.ts'
  if (summary.dirty === true) {
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith(ext) ? [join(d, e.name)] : []))
    return walk(`tests/${layer}`).reduce((n, f) => n + readFileSync(f, 'utf8').split('\n').length, 0)
  }
  const commit = summary.commit
  const files = spawnSync('git', ['ls-tree', '-r', '--name-only', commit, `tests/${layer}`], { encoding: 'utf8' }).stdout.split('\n').filter((f) => f.endsWith(ext))
  return files.reduce((n, f) => n + spawnSync('git', ['show', `${commit}:${f}`], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.split('\n').length, 0)
}

const pct = (x, y) => (x === 0 ? '' : `${(((y - x) / x) * 100).toFixed(0)}%`)
const row = (name, x, y, fmt = (v) => String(v)) => `| ${name} | ${fmt(x)} | ${fmt(y)} | ${pct(x, y)} |`
const s = (v) => `${v.toFixed(0)} s`

const out = [`# Tests: ${a} (${A.commit}) → ${b} (${B.commit})`, '', `Measured on ${B.machine}, one layer at a time.`, '']
let totalA = 0; let totalB = 0
for (const layer of ['unit', 'integration', 'component', 'e2e']) {
  const x = A.layers[layer]; const y = B.layers[layer]
  if (!x || !y) continue
  totalA += x.seconds; totalB += y.seconds
  out.push(`## ${layer}`, '', `| | ${a} | ${b} | change |`, '| --- | ---: | ---: | ---: |',
    row('wall time', x.seconds, y.seconds, s),
    row('tests', x.tests, y.tests), row('files', x.files, y.files),
    row('lines of test code', testLines(A, layer), testLines(B, layer)),
    row('failed', x.failed, y.failed), '')
}
out.push('## All layers', '', `| | ${a} | ${b} | change |`, '| --- | ---: | ---: | ---: |', row('wall time (excl. the e2e build)', totalA, totalB, s), '')
if (A.coverage && B.coverage) {
  out.push('## Coverage', '', `| | ${a} | ${b} |`, '| --- | ---: | ---: |')
  for (const side of ['node', 'component']) for (const m of ['lines', 'statements', 'functions', 'branches']) {
    out.push(`| ${side} ${m} | ${A.coverage[side]?.[m]?.pct ?? '?'}% | ${B.coverage[side]?.[m]?.pct ?? '?'}% |`)
  }
  out.push('')
}
const md = out.join('\n')
if (existsSync(dir(b))) writeFileSync(join(dir(b), 'compare.md'), md)
console.log(md)

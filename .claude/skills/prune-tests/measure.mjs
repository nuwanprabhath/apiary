#!/usr/bin/env node
// Measures the test suite: wall time, test count and per-file / per-test durations for each layer.
//
//   node .claude/skills/prune-tests/measure.mjs <label> [unit integration component e2e coverage]
//
// Runs the layers one after another (never in parallel: they would slow each other and the numbers
// would mean nothing), each with a JSON reporter, and writes `.agent-reports/test-stats/<label>/`:
// `summary.json` (what `compare.mjs` reads), `slowest.md`, and each layer's raw report. `coverage`
// runs `npm run test:coverage` and `npm run test:component:coverage` and keeps their summaries.
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const [label, ...asked] = process.argv.slice(2)
if (!label) { console.error('usage: measure.mjs <label> [unit integration component e2e coverage]'); process.exit(2) }
const layers = asked.length > 0 ? asked : ['unit', 'integration', 'component', 'e2e', 'coverage']
const out = join(ROOT, '.agent-reports', 'test-stats', label)
mkdirSync(out, { recursive: true })

const summaryPath = join(out, 'summary.json')
const summary = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, 'utf8')) : { label, layers: {} }
summary.machine = `${process.platform} ${process.arch}`
summary.commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).stdout.trim()
// Measured on uncommitted changes: `compare.mjs` then counts test lines from the working tree.
summary.dirty = spawnSync('git', ['status', '--porcelain', '--', 'tests', 'src'], { encoding: 'utf8' }).stdout.trim() !== ''

function run(cmd, args, env = {}) {
  const start = Date.now()
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 1 << 30, env: { ...process.env, ...env } })
  return { seconds: (Date.now() - start) / 1000, status: r.status, tail: `${r.stdout}\n${r.stderr}`.split('\n').slice(-40).join('\n') }
}

/** Vitest's JSON report: one entry per file, each with its tests. */
function fromVitest(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const files = report.testResults.map((f) => ({
    file: relative(ROOT, f.name),
    seconds: (f.endTime - f.startTime) / 1000,
    tests: f.assertionResults.map((t) => ({ name: t.fullName, seconds: (t.duration ?? 0) / 1000, status: t.status })),
  }))
  return { files, tests: report.numTotalTests, passed: report.numPassedTests, failed: report.numFailedTests, skipped: report.numPendingTests + (report.numTodoTests ?? 0) }
}

/** Playwright's JSON report: nested suites; a test's time is the sum of its attempts. */
function fromPlaywright(reportPath) {
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  const byFile = new Map()
  let passed = 0; let failed = 0; let skipped = 0; let tests = 0
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        tests++
        const seconds = (t.results ?? []).reduce((s, r) => s + (r.duration ?? 0), 0) / 1000
        const status = t.status === 'expected' || t.status === 'flaky' ? 'passed' : t.status === 'skipped' ? 'skipped' : 'failed'
        if (status === 'passed') passed++; else if (status === 'skipped') skipped++; else failed++
        const f = spec.file ?? file
        if (!byFile.has(f)) byFile.set(f, [])
        byFile.get(f).push({ name: `${t.projectName} › ${spec.title}`, seconds, status })
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.file ?? file)
  }
  for (const s of report.suites) walk(s, s.file)
  const files = [...byFile].map(([file, ts]) => ({ file: join('tests/e2e', file), seconds: ts.reduce((s, t) => s + t.seconds, 0), tests: ts }))
  return { files, tests, passed, failed, skipped }
}

const LAYERS = {
  unit: () => ['npx', ['vitest', 'run', '--project', 'unit', '--reporter=json', `--outputFile=${join(out, 'unit.json')}`], fromVitest, join(out, 'unit.json')],
  integration: () => ['npx', ['vitest', 'run', '--project', 'integration', '--reporter=json', `--outputFile=${join(out, 'integration.json')}`], fromVitest, join(out, 'integration.json')],
  component: () => ['npx', ['vitest', 'run', '--config', 'vitest.component.config.ts', '--reporter=json', `--outputFile=${join(out, 'component.json')}`], fromVitest, join(out, 'component.json')],
}

for (const layer of layers) {
  process.stdout.write(`measure: ${layer}… `)
  if (layer === 'coverage') {
    const node = run('npm', ['run', 'test:coverage'])
    const comp = run('npm', ['run', 'test:component:coverage'])
    const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')).total : null)
    summary.coverage = { node: read('coverage/node/coverage-summary.json'), component: read('coverage/component/coverage-summary.json'), seconds: node.seconds + comp.seconds, status: [node.status, comp.status] }
    for (const [from, to] of [['coverage/node/coverage-final.json', 'coverage-node-final.json'], ['coverage/component/coverage-final.json', 'coverage-component-final.json']]) if (existsSync(from)) copyFileSync(from, join(out, to))
    console.log(`${(node.seconds + comp.seconds).toFixed(0)} s`)
    continue
  }
  let result
  if (layer === 'e2e') {
    const build = run('npm', ['run', 'build'])
    if (build.status !== 0) { console.log('build failed'); console.log(build.tail); process.exit(1) }
    const report = join(out, 'e2e.json')
    result = run('npx', ['playwright', 'test', '--reporter=json'], { PLAYWRIGHT_JSON_OUTPUT_NAME: report })
    result.parsed = fromPlaywright(report)
    result.buildSeconds = build.seconds
  } else {
    const [cmd, args, parse, report] = LAYERS[layer]()
    result = run(cmd, args)
    result.parsed = parse(report)
  }
  const { files, ...counts } = result.parsed
  summary.layers[layer] = { seconds: result.seconds, buildSeconds: result.buildSeconds, exit: result.status, files: files.length, ...counts, fileSeconds: files.reduce((s, f) => s + f.seconds, 0) }
  writeFileSync(join(out, `${layer}.files.json`), JSON.stringify(files, null, 1))
  console.log(`${result.seconds.toFixed(0)} s, ${counts.tests} tests (${counts.failed} failed), exit ${result.status}`)
  if (result.status !== 0) writeFileSync(join(out, `${layer}.tail.txt`), result.tail)
}

writeFileSync(summaryPath, JSON.stringify(summary, null, 1))

// The slowest files and tests per layer: where a minute is most likely to be won.
const lines = [`# Slowest tests — ${label} (${summary.commit})`, '']
for (const layer of Object.keys(summary.layers)) {
  const p = join(out, `${layer}.files.json`)
  if (!existsSync(p)) continue
  const files = JSON.parse(readFileSync(p, 'utf8'))
  lines.push(`## ${layer}`, '', '| File | s | tests |', '| --- | ---: | ---: |')
  for (const f of [...files].sort((a, b) => b.seconds - a.seconds).slice(0, 25)) lines.push(`| ${f.file} | ${f.seconds.toFixed(1)} | ${f.tests.length} |`)
  lines.push('', '| Test | s |', '| --- | ---: |')
  for (const t of files.flatMap((f) => f.tests.map((x) => ({ ...x, file: f.file }))).sort((a, b) => b.seconds - a.seconds).slice(0, 25)) lines.push(`| ${t.file} › ${t.name} | ${t.seconds.toFixed(1)} |`)
  lines.push('')
}
writeFileSync(join(out, 'slowest.md'), lines.join('\n'))
console.log(`measure: wrote ${relative(ROOT, out)}/summary.json and slowest.md`)

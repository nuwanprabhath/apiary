#!/usr/bin/env node
// What each test file (or each test in one file) covers that nothing else does.
//
//   node .claude/skills/prune-tests/overlap.mjs files [unit integration component] [--jobs N] [--stats <label>]
//   node .claude/skills/prune-tests/overlap.mjs within <test file> [--stats <label>]
//
// `files` runs every test file of the named layers on its own with v8 coverage, then compares them
// all at once (unit, integration and component together: a unit file whose every statement an
// integration or component file also runs is a candidate too). `within` runs each test of one file
// on its own and compares them with the rest of the suite (the `files` run's union must exist).
//
// A covered item is a statement, a function or a branch arm, keyed by source path and position,
// not by istanbul's ids, so the node and browser layers agree. Output, in
// `.agent-reports/test-stats/overlap/`: `files.md` / `within-<name>.md` (the candidates, cheapest
// to lose first) and `cover-*.json` (each run's covered set, reused by later runs; `--fresh` redoes
// them).
//
// A file or test with no unique item is a CANDIDATE, not a verdict: coverage says a line ran, not
// that anything checked it. SKILL.md says how to decide.
import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const OUT = join(ROOT, '.agent-reports', 'test-stats', 'overlap')
const argv = process.argv.slice(2)
const flag = (name, dflt) => { const i = argv.indexOf(name); return i === -1 ? dflt : argv.splice(i, 2)[1] }
const fresh = argv.includes('--fresh') ? (argv.splice(argv.indexOf('--fresh'), 1), true) : false
const jobs = Number(flag('--jobs', '4'))
const statsLabel = flag('--stats', 'before')
const [mode, ...rest] = argv
mkdirSync(OUT, { recursive: true })

const LAYER = {
  unit: { dir: 'tests/unit', ext: '.test.ts', args: ['--project', 'unit'], jobs },
  integration: { dir: 'tests/integration', ext: '.test.ts', args: ['--project', 'integration'], jobs: 1 },
  component: { dir: 'tests/component', ext: '.test.tsx', args: ['--config', 'vitest.component.config.ts'], jobs: 1 },
}

const walk = (dir, ext) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(join(dir, e.name), ext) : e.name.endsWith(ext) ? [join(dir, e.name)] : [])

const slug = (s) => s.replace(/[^a-zA-Z0-9]+/g, '_').slice(-150)

/** The covered items of one istanbul `coverage-final.json`. */
function coveredItems(finalJson) {
  const items = new Set()
  const at = (loc) => `${loc.start.line}:${loc.start.column}-${loc.end.line}:${loc.end.column}`
  for (const [path, f] of Object.entries(finalJson)) {
    const file = relative(ROOT, path)
    for (const [id, n] of Object.entries(f.s)) if (n > 0) items.add(`${file}|s|${at(f.statementMap[id])}`)
    for (const [id, n] of Object.entries(f.f)) if (n > 0) items.add(`${file}|f|${at(f.fnMap[id].loc)}`)
    for (const [id, arms] of Object.entries(f.b)) arms.forEach((n, i) => { if (n > 0) items.add(`${file}|b|${at(f.branchMap[id].loc)}#${i}`) })
  }
  return items
}

/** Runs one vitest invocation with coverage into its own folder; resolves to the covered set. */
function covered(key, layer, extra) {
  const cache = join(OUT, `cover-${slug(key)}.json`)
  if (!fresh && existsSync(cache)) return Promise.resolve(new Set(JSON.parse(readFileSync(cache, 'utf8'))))
  const dir = join(OUT, 'tmp', slug(key))
  rmSync(dir, { recursive: true, force: true })
  const args = ['vitest', 'run', ...LAYER[layer].args, ...extra, '--coverage.enabled', '--coverage.reporter=json',
    `--coverage.reportsDirectory=${dir}`, '--coverage.thresholds.lines=0', '--coverage.thresholds.functions=0',
    '--coverage.thresholds.branches=0', '--coverage.thresholds.statements=0', '--reporter=dot']
  return new Promise((resolve) => {
    const child = spawn('npx', args, { stdio: ['ignore', 'ignore', 'pipe'], env: process.env })
    let err = ''
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000) })
    child.on('close', (code) => {
      const p = join(dir, 'coverage-final.json')
      if (!existsSync(p)) { console.error(`\noverlap: no coverage for ${key} (exit ${code})\n${err}`); resolve(new Set()); return }
      const items = coveredItems(JSON.parse(readFileSync(p, 'utf8')))
      writeFileSync(cache, JSON.stringify([...items]))
      rmSync(dir, { recursive: true, force: true })
      if (code !== 0) console.error(`\noverlap: ${key} exited ${code} (failing tests still give coverage; check it)`)
      resolve(items)
    })
  })
}

async function pool(tasks, n) {
  const results = new Array(tasks.length)
  let next = 0; let done = 0
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
      process.stdout.write(`\roverlap: ${++done}/${tasks.length}`)
    }
  }))
  process.stdout.write('\n')
  return results
}

/** Seconds per test file and per test, from `measure.mjs <statsLabel>`, if it was run. */
function timings() {
  const dir = join(ROOT, '.agent-reports', 'test-stats', statsLabel)
  const file = new Map(); const test = new Map()
  for (const layer of ['unit', 'integration', 'component']) {
    const p = join(dir, `${layer}.files.json`)
    if (!existsSync(p)) continue
    for (const f of JSON.parse(readFileSync(p, 'utf8'))) {
      file.set(f.file, f.seconds)
      for (const t of f.tests) test.set(`${f.file}::${t.name}`, t.seconds)
    }
  }
  return { file, test }
}

/** For each run: its items, how many only it covers, and the one other run that contains most of it. */
function compare(runs, against) {
  const count = new Map()
  for (const r of [...runs, ...against]) for (const it of r.items) count.set(it, (count.get(it) ?? 0) + 1)
  return runs.map((r) => {
    const unique = [...r.items].filter((it) => count.get(it) === 1)
    let best = { key: '', share: 0 }
    if (r.items.size > 0) {
      for (const o of [...runs, ...against]) {
        if (o === r || o.items.size === 0) continue
        let shared = 0
        for (const it of r.items) if (o.items.has(it)) shared++
        const share = shared / r.items.size
        if (share > best.share) best = { key: o.key, share }
      }
    }
    const uniqueFiles = [...new Set(unique.map((u) => u.split('|')[0]))]
    return { key: r.key, covered: r.items.size, unique: unique.length, uniqueFiles, best }
  })
}

const table = (rows, seconds) => [
  '| Run | s | covered | unique | where the unique items are | most contained by | share |',
  '| --- | ---: | ---: | ---: | --- | --- | ---: |',
  ...rows.map((r) => `| ${r.key} | ${(seconds(r.key) ?? 0).toFixed(1)} | ${r.covered} | ${r.unique} | ${r.uniqueFiles.slice(0, 3).join(', ')}${r.uniqueFiles.length > 3 ? ', …' : ''} | ${r.best.key} | ${(r.best.share * 100).toFixed(0)}% |`),
]

if (mode === 'files') {
  const layers = rest.length > 0 ? rest : ['unit', 'integration', 'component']
  const runs = []
  for (const layer of layers) {
    const files = walk(LAYER[layer].dir, LAYER[layer].ext).map((f) => relative(ROOT, f)).sort()
    console.log(`overlap: ${layer}, ${files.length} files, ${LAYER[layer].jobs} at a time`)
    const sets = await pool(files.map((f) => () => covered(f, layer, [f])), LAYER[layer].jobs)
    files.forEach((f, i) => runs.push({ key: f, items: sets[i] }))
  }
  writeFileSync(join(OUT, 'files.index.json'), JSON.stringify(runs.map((r) => r.key)))
  const { file } = timings()
  const rows = compare(runs, []).sort((a, b) => a.unique - b.unique || (file.get(b.key) ?? 0) - (file.get(a.key) ?? 0))
  const none = rows.filter((r) => r.unique === 0 && r.covered > 0)
  const md = [
    '# Test files by what only they cover', '',
    `${rows.length} files. ${none.length} cover nothing no other file covers; ${rows.filter((r) => r.covered === 0).length} cover no instrumented source at all (architecture tests, scripts, fixtures: judge them by what they assert).`, '',
    ...table(rows, (k) => file.get(k)),
  ]
  writeFileSync(join(OUT, 'files.md'), md.join('\n'))
  console.log(`overlap: wrote ${relative(ROOT, join(OUT, 'files.md'))} (${none.length} files with no unique coverage)`)
} else if (mode === 'within') {
  const target = rest[0]
  if (!target) { console.error('usage: overlap.mjs within <test file>'); process.exit(2) }
  const layer = target.startsWith('tests/component/') ? 'component' : target.startsWith('tests/integration/') ? 'integration' : 'unit'
  const indexPath = join(OUT, 'files.index.json')
  if (!existsSync(indexPath)) { console.error('overlap: run `overlap.mjs files` first; `within` compares against its runs'); process.exit(2) }
  const others = JSON.parse(readFileSync(indexPath, 'utf8')).filter((k) => k !== target)
    .map((k) => ({ key: k, items: new Set(JSON.parse(readFileSync(join(OUT, `cover-${slug(k)}.json`), 'utf8'))) }))
  const { test } = timings()
  const names = [...test.keys()].filter((k) => k.startsWith(`${target}::`)).map((k) => k.slice(target.length + 2))
  if (names.length === 0) { console.error(`overlap: no test names for ${target} in measure's ${statsLabel} run`); process.exit(2) }
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sets = await pool(names.map((n) => () => covered(`${target}::${n}`, layer, [target, '-t', `^${esc(n)}$`])), 1)
  const runs = names.map((n, i) => ({ key: `${target}::${n}`, items: sets[i] }))
  const rows = compare(runs, others).sort((a, b) => a.unique - b.unique)
  const name = slug(target)
  writeFileSync(join(OUT, `within-${name}.md`), [`# ${target}: what each test covers that nothing else in the suite does`, '', ...table(rows, (k) => test.get(k))].join('\n'))
  console.log(`overlap: wrote ${relative(ROOT, join(OUT, `within-${name}.md`))}`)
} else {
  console.error('usage: overlap.mjs files [layers…] | within <test file>'); process.exit(2)
}

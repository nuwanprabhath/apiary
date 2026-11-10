#!/usr/bin/env node
/**
 * The library-scale benchmark: builds a synthetic library of N sessions and times the main-process
 * paths whose cost grows with it (refresh passes, `tree()`, the search index, transcript pages).
 *
 *     APIARY_BENCH_SESSIONS=5000 node scripts/bench/libraryScale.mjs [label]
 *
 * The work is in `tests/fixtures/bench/library.ts`; this bundles it with esbuild (the services are
 * TypeScript with path aliases) and runs it under plain Node. Writes
 * `bench-results/library-<label>/summary.json` (gitignored) and prints a table.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const repo = resolve(import.meta.dirname, '../..')
const argv = process.argv.slice(2)
const flag = argv.indexOf('--sessions')
const sessionsArg = flag >= 0 ? argv.splice(flag, 2)[1] : undefined
const label = argv[0] ?? 'default'
const sessions = Number(sessionsArg ?? process.env.APIARY_BENCH_SESSIONS ?? 5000)
if (!Number.isInteger(sessions) || sessions < 1) {
  console.error(`APIARY_BENCH_SESSIONS must be a positive integer, got ${process.env.APIARY_BENCH_SESSIONS}`)
  process.exit(2)
}

const outDir = join(repo, 'bench-results', `library-${label}`)
mkdirSync(outDir, { recursive: true })
// In `test-results/`, which the linters skip; inside the repo so its externals resolve from node_modules.
const bundleDir = join(repo, 'test-results', 'bench-library')
mkdirSync(bundleDir, { recursive: true })
const bundle = join(bundleDir, 'library.bundle.cjs')
await build({
  entryPoints: [join(repo, 'tests/fixtures/bench/library.ts')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  packages: 'external',
  alias: { '@shared': join(repo, 'src/shared') },
  logLevel: 'error',
  // The session services never open a window, but modules beside them import `electron`; under plain
  // Node it is a stand-in whose every member is an inert function.
  plugins: [{
    name: 'electron-stand-in',
    setup(b) {
      b.onResolve({ filter: /^electron(-updater)?$/ }, (args) => ({ path: args.path, namespace: 'stand-in' }))
      b.onLoad({ filter: /.*/, namespace: 'stand-in' }, () => ({
        loader: 'js',
        contents: 'const inert = new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : inert), apply: () => undefined, construct: () => ({}) }); module.exports = inert',
      }))
    },
  }],
})

const { runLibraryBenchmark } = await import(pathToFileURL(bundle).href)
console.log(`building ${sessions} sessions...`)
const summary = await runLibraryBenchmark(label, { sessions })
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))

const c = summary.config
console.log(`\n${c.sessions} sessions in ${c.folders} folders (${c.small} short, ${c.long} of 5,000 lines, ${c.huge} of 50,000), Node ${c.node}`)
console.log('path'.padEnd(26) + 'median ms'.padStart(12) + 'worst ms'.padStart(12))
for (const [name, t] of Object.entries(summary.timings)) {
  console.log(name.padEnd(26) + String(t.median).padStart(12) + String(t.worst).padStart(12))
}
console.log(`tree() as JSON: ${summary.treeJsonBytes} bytes`)
console.log(`\nwrote ${join(outDir, 'summary.json')}`)

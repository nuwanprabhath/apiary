// Dead code that may only shrink. Runs knip (knip.json: unused files, exports, types, dependencies)
// and compares its findings with `.knip-baseline.json`:
// - a finding not in the baseline fails: delete the dead code, or use it;
// - a baseline entry knip no longer reports also fails, so the baseline cannot keep a stale entry
//   that would later hide a new finding with the same name: run `npm run lint:dead:baseline`.
// knip itself has no baseline mode; this is the same shrink-only contract as
// eslint-suppressions.json and dependency-cruiser's known violations.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const BASELINE = '.knip-baseline.json'
const write = process.argv.includes('--write-baseline')

let raw
try {
  raw = execFileSync('npx', ['knip', '--reporter', 'json', '--no-exit-code'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
} catch (e) {
  console.error('knip-ratchet: knip failed to run.\n', e instanceof Error ? e.message : e)
  process.exit(2)
}
const report = JSON.parse(raw)

/** @type {Set<string>} */
const found = new Set()
for (const issue of report.issues ?? []) {
  for (const [kind, value] of Object.entries(issue)) {
    if (kind === 'file' || value === null || typeof value !== 'object') continue
    const items = Array.isArray(value) ? value : Object.values(value)
    for (const item of items) {
      const name = typeof item === 'object' && item !== null && 'name' in item ? item.name : String(item)
      found.add(`${kind}  ${issue.file}  ${name}`)
    }
  }
}

if (write) {
  writeFileSync(BASELINE, `${JSON.stringify([...found].sort(), null, 2)}\n`)
  console.log(`knip-ratchet: baseline written with ${String(found.size)} entries.`)
  process.exit(0)
}

const baseline = new Set(existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : [])
const fresh = [...found].filter((k) => !baseline.has(k))
const stale = [...baseline].filter((k) => !found.has(k))
if (fresh.length) {
  console.error('knip-ratchet: new dead code (unused file, export, type or dependency). Delete it or use it:')
  for (const k of fresh) console.error(`  ${k}`)
}
if (stale.length) {
  console.error('knip-ratchet: fixed since the baseline — run `npm run lint:dead:baseline` to shrink it:')
  for (const k of stale) console.error(`  ${k}`)
}
if (fresh.length || stale.length) process.exit(1)
console.log(`knip-ratchet: no new dead code (${String(baseline.size)} baselined).`)

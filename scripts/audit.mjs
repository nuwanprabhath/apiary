#!/usr/bin/env node
// `npm audit --audit-level=low` over every dependency, dev included (`--omit=dev` hides
// Electron's own CVEs), except advisories named below.
//
// An advisory goes here only when no fixed version exists and it cannot reach us. Each entry has a
// review-by date: past it, the gate fails again so someone looks for a fix. An entry whose
// advisory no longer shows up is reported so it can be removed.
//
// `devOnly` allows an advisory only in build and lint tooling: the gate still fails if it shows up
// in what the app ships (`npm audit --omit=dev`).
import { spawnSync } from 'node:child_process'

/** @type {Record<string, { review: string, why: string, devOnly?: boolean }>} */
const ALLOWED = {
  'GHSA-g3hv-75wg-m249': {
    review: '2026-12-15',
    devOnly: true,
    why: 'minimatch <11.0.1 (glob-pattern DoS). Ours and ESLint\'s are on 11 (overrides in package.json); '
      + 'electron-builder 26.18 still pins @electron/asar 3, glob 7, dir-compare and jake, whose minimatch '
      + '3/5/9 have no fix and match only our own packaging globs at build time.',
  },
}

/** Advisory id → its one-line description, from `npm audit` with the given extra arguments. */
function audit(args) {
  const run = spawnSync('npm', ['audit', '--json', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 })
  let report
  try {
    report = JSON.parse(run.stdout)
  } catch {
    console.error(run.stderr || run.stdout || 'audit: npm audit printed no report')
    process.exit(1)
  }
  if (report.error) {
    console.error(`audit: ${report.error.summary ?? JSON.stringify(report.error)}`)
    process.exit(1)
  }
  // Advisories are the objects in `via`; string entries are packages that only depend on one.
  const found = new Map()
  for (const vuln of Object.values(report.vulnerabilities ?? {})) {
    for (const via of vuln.via) {
      if (typeof via !== 'object') continue
      const id = via.url?.split('/').pop() ?? String(via.source)
      found.set(id, `${via.severity} ${via.name} ${via.range}: ${via.title} (${via.url})`)
    }
  }
  return found
}

const found = audit([])
const shipped = Object.values(ALLOWED).some((a) => a.devOnly === true) ? audit(['--omit=dev']) : new Map()

const today = new Date().toISOString().slice(0, 10)
let failed = false
for (const [id, line] of found) {
  const allowed = ALLOWED[id]
  if (!allowed) {
    console.error(`audit: ${line}`)
    failed = true
  } else if (allowed.devOnly === true && shipped.has(id)) {
    console.error(`audit: ${id} is allowed only in dev tooling, and the app now ships it. ${line}`)
    failed = true
  } else if (allowed.review < today) {
    console.error(`audit: ${id} was allowed until ${allowed.review}; look for a fix. ${line}`)
    failed = true
  } else {
    console.log(`audit: allowed until ${allowed.review}: ${id}. ${allowed.why}`)
  }
}
for (const id of Object.keys(ALLOWED)) {
  if (!found.has(id)) console.log(`audit: ${id} no longer reported; remove it from scripts/audit.mjs`)
}

if (failed) {
  console.error('audit: failing. Run `npm audit` for the full report.')
  process.exit(1)
}
console.log(`audit: ok (${found.size} allowed, none other)`)

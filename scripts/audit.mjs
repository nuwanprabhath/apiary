#!/usr/bin/env node
// `npm audit --audit-level=low` over every dependency, dev included (SEC-1: `--omit=dev` hid
// Electron's own CVEs), except advisories named below.
//
// An advisory goes here only when no fixed version exists and it cannot reach us. Each entry has a
// review-by date: past it, the gate fails again so someone looks for a fix. An entry whose
// advisory no longer shows up is reported so it can be removed.
import { spawnSync } from 'node:child_process'

const ALLOWED = {
  'GHSA-vfj7-8cjw-p6xm': {
    review: '2026-12-31',
    why:
      'braces <=3.0.3 (no fixed release): stack exhaustion on deeply nested glob patterns. ' +
      'Only reached through markdownlint-cli2 and stylelint, dev tools fed our own fixed globs.',
  },
}

const run = spawnSync('npm', ['audit', '--json'], { encoding: 'utf8', maxBuffer: 64 << 20 })
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

const today = new Date().toISOString().slice(0, 10)
let failed = false
for (const [id, line] of found) {
  const allowed = ALLOWED[id]
  if (!allowed) {
    console.error(`audit: ${line}`)
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

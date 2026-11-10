#!/usr/bin/env node
// Turns the nightly run's JUnit file into one open GitHub issue (label `nightly-e2e`): opened or
// updated while tests fail or needed their retry, closed when a run is clean. Per OS, because the
// workflow runs this once per matrix leg and each leg owns its own section of the issue body.
// Run by .github/workflows/nightly-e2e.yml with `gh` and GH_TOKEN.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const LABEL = 'nightly-e2e'

function unescapeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function attr(tag, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag)
  return m ? unescapeXml(m[1]) : ''
}

/**
 * `failed`: a title whose every attempt failed. `flaky`: a title that failed and then passed
 * (Playwright writes each attempt as its own testcase, or marks a retry with `flakyFailure`).
 */
export function parseJunit(xml) {
  const outcomes = new Map()
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g
  for (const m of xml.matchAll(re)) {
    const title = [attr(m[1], 'classname'), attr(m[1], 'name')].filter(Boolean).join(' › ')
    const body = m[3] ?? ''
    if (/<skipped\b/.test(body)) continue
    const entry = outcomes.get(title) ?? { pass: false, fail: false, flaky: false }
    if (/<(failure|error)\b/.test(body)) entry.fail = true
    else entry.pass = true
    if (/<flakyFailure\b/.test(body)) entry.flaky = true
    outcomes.set(title, entry)
  }
  const failed = []
  const flaky = []
  for (const [title, o] of outcomes) {
    if (o.fail && !o.pass) failed.push(title)
    else if (o.fail || o.flaky) flaky.push(title)
  }
  return { failed, flaky }
}

export function renderSection(os, { failed, flaky }) {
  const list = (items) => items.map((t) => `- ${t}`).join('\n')
  const parts = [`## ${os}`]
  if (failed.length) parts.push(`Failed (${failed.length}):`, list(failed))
  if (flaky.length) parts.push(`Needed a retry (${flaky.length}):`, list(flaky))
  return parts.join('\n\n')
}

const SECTION = /^## (.+)$/m

/** Replaces the section for `os` in an existing body, or appends it; an empty result drops it. */
export function mergeBody(existing, os, result, runUrl) {
  const sections = new Map()
  for (const chunk of existing.split(/^(?=## )/m)) {
    const m = SECTION.exec(chunk)
    if (m) sections.set(m[1].trim(), chunk.trim())
  }
  if (result.failed.length || result.flaky.length) {
    sections.set(os, `${renderSection(os, result)}\n\nRun: ${runUrl}`)
  } else sections.delete(os)
  return [...sections.values()].join('\n\n')
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim()
}

function main() {
  const os = process.env.RUNNER_OS ?? 'unknown'
  const runUrl = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
  const file = process.argv[2] ?? 'test-results/junit.xml'
  const result = existsSync(file) ? parseJunit(readFileSync(file, 'utf8')) : { failed: [], flaky: [] }
  gh(['label', 'create', LABEL, '--color', 'B60205', '--description', 'Opened by the nightly e2e run', '--force'])
  const number = gh(['issue', 'list', '--state', 'open', '--label', LABEL, '--json', 'number', '--jq', '.[0].number // empty'])
  const existing = number ? gh(['issue', 'view', number, '--json', 'body', '--jq', '.body']) : ''
  const body = mergeBody(existing, os, result, runUrl)
  if (!body) {
    if (number) gh(['issue', 'close', number, '--comment', `The nightly e2e run is clean again: ${runUrl}`])
    return
  }
  const text = `The nightly e2e run found problems on \`main\`. Traces are in the run's \`e2e-results-*\` artifact.\n\n${body}`
  if (!number) gh(['issue', 'create', '--title', 'Nightly e2e: failing or flaky tests', '--label', LABEL, '--body', text])
  else if (text !== existing) gh(['issue', 'edit', number, '--body', text])
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main()

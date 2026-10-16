/**
 * Captures real Claude Code terminal output as fixtures for `classifyActivity`.
 *
 * Fixtures are recorded from a genuine session, through the app's own pty plumbing and replay
 * buffer, because a hand-written fixture proves only that a pattern matches the fixture.
 *
 * Run it deliberately, not in CI — it spends real tokens (Haiku) and needs `claude` on PATH:
 *
 *     npm run rebuild:node && node scripts/capture-activity-fixtures.mjs
 *
 * Each scenario writes `tests/fixtures/activity/<name>.txt` (raw bytes, escapes and all) plus a
 * `<name>.json` recording how long before the snapshot the last output landed — the second input
 * `classifyActivity` takes. Review a regenerated fixture by eye before committing it.
 */
import { spawn } from 'node-pty'
import headless from '@xterm/headless'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const { Terminal } = headless

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'activity')
const REPLAY_BYTES = 256 * 1024

const cwd = mkdtempSync(join(tmpdir(), 'apiary-activity-'))
mkdirSync(OUT_DIR, { recursive: true })

const shell = process.env.SHELL ?? '/bin/bash'
const child = spawn(shell, ['-l', '-c', 'exec claude --model haiku'], {
  name: 'xterm-256color',
  cols: 120,
  rows: 40,
  cwd,
  env: { ...process.env },
})

let buffer = ''
let lastOutputAt = 0
child.onData((data) => {
  buffer = (buffer + data).slice(-REPLAY_BYTES)
  lastOutputAt = Date.now()
  if (process.env.VERBOSE === '1') process.stdout.write(data)
})

let exited = false
child.onExit(() => { exited = true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function quiet(ms, timeout = 120_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (Date.now() - lastOutputAt >= ms) return true
    await sleep(100)
  }
  return false
}

/**
 * The screen as a person sees it, using the app's renderer. Claude Code 2.x lays words out by
 * jumping the cursor (`ESC[12G`) instead of printing spaces, so a raw `buffer.includes(...)` never
 * matches. Only the *waiting* is rendered; the fixture records the untouched bytes.
 */
function render(raw) {
  const term = new Terminal({ cols: 120, rows: 40, scrollback: 0, allowProposedApi: true })
  return new Promise((resolve) => {
    term.write(raw, () => {
      const b = term.buffer.active
      const lines = []
      for (let i = 0; i < term.rows; i += 1) {
        lines.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? '')
      }
      term.dispose()
      resolve(lines.join('\n'))
    })
  })
}

async function until(needle, timeout = 120_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await render(buffer)).includes(needle)) return true
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${JSON.stringify(needle)}`)
}

/** Types a prompt and submits it, once the TUI has settled. Claude Code 2.x does not switch to
 *  the alternate screen, so quiet is the only readiness signal available. */
async function send(text) {
  await quiet(1200)
  child.write(text)
  await sleep(500)
  child.write('\r')
}

function snapshot(name, note) {
  const sinceLastOutputMs = Date.now() - lastOutputAt
  writeFileSync(join(OUT_DIR, `${name}.txt`), buffer)
  writeFileSync(
    join(OUT_DIR, `${name}.json`),
    `${JSON.stringify({ name, note, sinceLastOutputMs, capturedAt: new Date().toISOString() }, null, 2)}\n`,
  )
  console.log(`captured ${name} (last output ${sinceLastOutputMs}ms ago, ${buffer.length} bytes)`)
}

async function main() {
  // A fresh directory is untrusted, so the first thing on screen is a selection prompt. That is a
  // genuine "waiting on you" state and worth recording before it is answered.
  await until('trust this folder')
  await quiet(2000)
  snapshot('trust-prompt', 'startup folder-trust selection, awaiting a choice')
  child.write('\x1b[B')
  await sleep(300)
  child.write('\r')
  await quiet(2500)
  // A session that has started and is sitting at its composer having done nothing.
  snapshot('startup-idle', 'just launched, empty composer, nothing running')

  // The bug this whole exercise came from: Claude answers a question, the answer and the question
  // both sit in the scrollback ending in "?", and the session is doing nothing at all.
  await send('In one short sentence: what is a pty?')
  await quiet(4000)
  snapshot('idle-after-answer', 'finished answering, composer empty, nothing running')

  await send('What are the ways third-party apps can know the status of a Claude session? e.g. running, stopped, asking a question etc?')
  await sleep(2500)
  snapshot('working', 'mid-answer, output still streaming')
  await quiet(5000)
  snapshot('idle-after-question-prose', 'answer finished; question marks left in the scrollback')

  // A tool call that needs approval: the permission box, which is the state the dot must catch.
  await send('Run the bash command: ls -la')
  try {
    await until('Do you want to proceed?', 90_000)
    await quiet(2000)
    snapshot('permission-prompt', 'permission box on screen, awaiting a choice')
    child.write('\x1b') // escape, decline
    await quiet(3000)
    snapshot('idle-after-escape', 'prompt dismissed, back to the composer')
  } catch (error) {
    console.warn(`permission prompt not captured: ${error.message}`)
  }

  child.write('\x04')
  await sleep(1500)
  if (!exited) child.kill()
  console.log(`\nfixtures written to ${OUT_DIR}`)
  process.exit(0)
}

main().catch((error) => { console.error(error); child.kill(); process.exit(1) })

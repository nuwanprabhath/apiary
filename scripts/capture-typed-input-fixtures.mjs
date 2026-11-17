/**
 * Captures real Claude Code screens with text typed (not sent) into its input box, as fixtures
 * for `typedInput` (`src/shared/typedInput.ts`): what carries over when a tab switches from the
 * Terminal view to the Chat view.
 *
 * Run it deliberately, not in CI: it spends a few real tokens (Haiku) and needs `claude` on PATH:
 *
 *     npm run rebuild:node && node scripts/capture-typed-input-fixtures.mjs
 *
 * Each scenario writes `tests/fixtures/typed-input/<name>.txt` (raw bytes, escapes and all). The
 * test renders them through the app's own headless terminal, so cell attributes (the dim
 * placeholder) are what the app sees. Review a regenerated fixture by eye before committing it.
 */
import { spawn } from 'node-pty'
import headless from '@xterm/headless'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const { Terminal } = headless

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'typed-input')
const REPLAY_BYTES = 512 * 1024

const cwd = mkdtempSync(join(tmpdir(), 'apiary-typed-'))
mkdirSync(OUT_DIR, { recursive: true })

const shell = process.env.SHELL ?? '/bin/bash'
const child = spawn(shell, ['-l', '-c', 'exec claude --model haiku'], {
  name: 'xterm-256color', cols: 120, rows: 40, cwd, env: { ...process.env },
})

let buffer = ''
let lastOutputAt = 0
child.onData((data) => {
  buffer = (buffer + data).slice(-REPLAY_BYTES)
  lastOutputAt = Date.now()
})

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function quiet(ms, timeout = 120_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (Date.now() - lastOutputAt >= ms) return
    await sleep(100)
  }
}

function render(raw) {
  const term = new Terminal({ cols: 120, rows: 40, scrollback: 0, allowProposedApi: true })
  return new Promise((resolve) => {
    term.write(raw, () => {
      const b = term.buffer.active
      const lines = []
      for (let i = 0; i < term.rows; i += 1) lines.push(b.getLine(b.viewportY + i)?.translateToString(true) ?? '')
      term.dispose()
      resolve(lines.join('\n'))
    })
  })
}

async function until(needle, timeout = 120_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await render(buffer)).includes(needle)) return
    await sleep(250)
  }
  throw new Error(`timed out waiting for ${JSON.stringify(needle)}`)
}

/** Types text one key at a time, as a person would; Claude Code reads a burst as a paste. */
async function type(text) {
  for (const ch of text) {
    child.write(ch)
    await sleep(15)
  }
}

function snapshot(name, note) {
  writeFileSync(join(OUT_DIR, `${name}.txt`), buffer)
  console.log(`captured ${name}: ${note} (${buffer.length} bytes)`)
}

/** Clears the input box between scenarios. Only here: Apiary itself never types into the box. */
async function clearBox() {
  child.write('\x1b')
  await sleep(200)
  child.write('\x1b')
  await quiet(800)
}

async function main() {
  await until('trust this folder')
  await quiet(1500)
  child.write('\x1b[B') // the default is "No, exit"
  await sleep(300)
  child.write('\r')
  await quiet(2500)

  snapshot('empty-placeholder', 'empty input box showing the dim placeholder hint')

  await type('You can use this worktree related to #2779.')
  await quiet(800)
  snapshot('one-line', 'one line typed, not sent')
  await clearBox()

  await type('This is a long message that keeps going well past the width of the terminal so that Claude Code has to wrap it onto a second line of its input box.')
  await quiet(800)
  snapshot('wrapped', 'one long line that wraps in the box')
  await clearBox()

  await type('first line')
  child.write('\\')
  await sleep(100)
  child.write('\r')
  await sleep(200)
  await type('second line')
  await quiet(800)
  snapshot('two-lines', 'two lines, the second after backslash+enter (a newline in the box)')
  await clearBox()

  await type('Count slowly from 1 to 40, one number per line, with a short word after each.')
  await sleep(300)
  child.write('\r')
  await sleep(1500)
  await type('next I want to ask about ptys')
  await sleep(400)
  snapshot('running', 'typed text while Claude is answering (spinner shown)')
  child.write('\x1b')
  await quiet(1500)

  child.write('\x03')
  await sleep(300)
  child.write('\x03')
  await sleep(1000)
  child.kill()
  console.log(`\nfixtures written to ${OUT_DIR}`)
  process.exit(0)
}

main().catch((error) => { console.error(error); child.kill(); process.exit(1) })

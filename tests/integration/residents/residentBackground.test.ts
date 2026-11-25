import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { IPC } from '@shared/ipc/contract'
import { NEW_UPDATE, type ResidentMessage, type ResidentMessagePush } from '@shared/domain/residents'
import { ResidentChat } from '../../../src/main/residents/residentChat'
import { ResidentSpace } from '../../../src/main/residents/residentSpace'
import { broadcast } from '../../../src/main/windows/broadcast'

const windows: { id: number; heard: unknown[] }[] = [{ id: 1, heard: [] }, { id: 2, heard: [] }]
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => windows.map((w) => ({
      isDestroyed: () => false,
      webContents: { id: w.id, send: (channel: string, ...payload: unknown[]) => { if (channel === IPC.residentMessage.channel) w.heard.push(payload[0]) } },
    })),
  },
}))

/** tests/fixtures/fake-claude-chat.mjs: "background" starts a task, ends the turn, and answers again on its own when the task ends;
 *  a "held" task ends only at `/report-back`, so no test races the fixture's real-time timer. */
const FAKE = resolve(__dirname, '../../fixtures/fake-claude-chat.mjs')

/** Runs the fake directly instead of through `$SHELL -l -c 'exec "$0" "$@"' bin …`: a login shell
 *  sources the user's profile, which a busy machine stretches past the test's 5 s. */
function direct(_file: string, args: string[], options: SpawnOptions): ChildProcess {
  const [, , , bin, ...rest] = args
  if (bin === undefined) throw new Error(`not a login-shell exec: ${args.join(' ')}`)
  const child = nodeSpawn(process.execPath, [bin, ...rest], options)
  started.push(child)
  return child
}
const started: ChildProcess[] = []

/** Ends the fake's "held" background task without a message, as a real task ends on its own. */
function finishHeldTask(): void {
  const child = started.at(-1)
  if (child === undefined) throw new Error('no fake claude started')
  child.kill('SIGUSR2')
}

const dirs: string[] = []
const chats: ResidentChat[] = []
afterEach(async () => {
  await Promise.all(chats.splice(0).map((c) => c.stop()))
  started.length = 0
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Seen { busy: boolean; working: boolean; activity: string | null }

function chat(whenActive?: (space: ResidentSpace, c: ResidentChat) => void): { chat: ResidentChat; pushed: ResidentMessage[]; seen: Seen[]; space: ResidentSpace } {
  const dir = mkdtempSync(join(tmpdir(), 'apiary-resident-bg-'))
  dirs.push(dir)
  const space = new ResidentSpace(dir, 'regent')
  const pushed: ResidentMessage[] = []
  const seen: Seen[] = []
  const c: ResidentChat = new ResidentChat({
    space,
    name: () => 'Regent',
    claudeBin: () => FAKE,
    env: () => ({}),
    spawn: direct,
    launch: async () => ({ mcpConfig: space.writeMcpConfig('http://127.0.0.1:1/mcp', 'token'), model: 'sonnet', systemPrompt: 'x', permissionMode: 'manual' }),
    titleOf: () => null,
    onMessage: (m) => {
      pushed.push(m)
      const push: ResidentMessagePush = { residentId: 'r1', message: m }
      broadcast(IPC.residentMessage, push)
    },
    onActivity: () => {
      seen.push({ busy: c.busy, working: c.working, activity: c.activity() })
      whenActive?.(space, c)
    },
  })
  chats.push(c)
  return { chat: c, pushed, seen, space }
}

const done = (pushed: ResidentMessage[]): string[] => pushed.filter((m) => m.role === 'assistant' && !m.streaming).map((m) => m.text)

describe('a turn claude starts on its own', () => {
  it('is saved, pushed to every window, says what it waits on between turns, and asks for attention', async () => {
    const { chat: c, pushed, seen, space } = chat()
    await c.send('run it held in the background')
    await vi.waitFor(() => { expect(seen).toContainEqual({ busy: false, working: true, activity: 'Sleep, then say done' }) }, 4000)
    finishHeldTask()
    await vi.waitFor(() => { expect(done(pushed)).toEqual(['Started it in the background.', 'The background task finished.']) }, 4000)
    // Between the turns no turn runs, but the task does: working, in the task's own words.
    expect(seen).toContainEqual({ busy: false, working: true, activity: 'Sleep, then say done' })
    // The unsolicited turn is a turn: busy, with an activity.
    expect(seen.some((s) => s.busy && s.activity === 'Writing')).toBe(true)
    await vi.waitFor(() => { expect(c.busy).toBe(false) })
    expect(c.working).toBe(false)
    const saved = JSON.parse(readFileSync(join(space.dir, 'history.json'), 'utf8')) as unknown
    expect(JSON.stringify(saved)).toContain('The background task finished.')
    expect(c.history().map((m) => m.text)).toContain('The background task finished.')
    expect(space.attention()).toEqual(NEW_UPDATE)
    // Every window hears it, whichever has the popup open: residentMessage is broadcast.
    for (const w of windows) {
      expect(w.heard.some((p) => (p as ResidentMessagePush).message.text === 'The background task finished.')).toBe(true)
    }
  })

  it('leaves attention alone when the resident set it itself during that turn', async () => {
    // The unsolicited turn is busy for ~100 ms, so a poll on `busy` can miss it on a stalled machine:
    // the resident sets attention from inside the first activity event of that turn instead.
    let set = false
    const { chat: c, pushed, space } = chat((sp, ch) => {
      if (set || !ch.busy || done(pushed).length < 1) return
      set = true
      sp.setAttention(null)
    })
    await c.send('run it held in the background')
    await vi.waitFor(() => { expect(done(pushed)).toHaveLength(1) }, 4000)
    await vi.waitFor(() => { expect(c.busy).toBe(false) }, 4000)
    finishHeldTask()
    await vi.waitFor(() => { expect(done(pushed)).toHaveLength(2) }, 4000)
    await vi.waitFor(() => { expect(c.busy).toBe(false) })
    expect(space.attention()).toBeNull()
  })

  it('does not ask for attention after a turn the user started', async () => {
    const { chat: c, pushed, space } = chat()
    await c.send('hello')
    await vi.waitFor(() => { expect(done(pushed)).toHaveLength(1) }, 5000)
    await vi.waitFor(() => { expect(c.busy).toBe(false) })
    expect(space.attention()).toBeNull()
  })
})

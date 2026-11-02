import { afterEach, describe, expect, it, vi } from 'vitest'
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

/** tests/fixtures/fake-claude-chat.mjs: "background" starts a task, ends the turn, and answers again on its own when the task ends. */
const FAKE = resolve(__dirname, '../../fixtures/fake-claude-chat.mjs')

const dirs: string[] = []
const chats: ResidentChat[] = []
afterEach(async () => {
  await Promise.all(chats.splice(0).map((c) => c.stop()))
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Seen { busy: boolean; working: boolean; activity: string | null }

function chat(): { chat: ResidentChat; pushed: ResidentMessage[]; seen: Seen[]; space: ResidentSpace } {
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
    launch: async () => ({ mcpConfig: space.writeMcpConfig('http://127.0.0.1:1/mcp', 'token'), model: 'sonnet', systemPrompt: 'x', permissionMode: 'manual' }),
    titleOf: () => null,
    onMessage: (m) => {
      pushed.push(m)
      const push: ResidentMessagePush = { residentId: 'r1', message: m }
      broadcast(IPC.residentMessage, push)
    },
    onActivity: () => { seen.push({ busy: c.busy, working: c.working, activity: c.activity() }) },
  })
  chats.push(c)
  return { chat: c, pushed, seen, space }
}

const done = (pushed: ResidentMessage[]): string[] => pushed.filter((m) => m.role === 'assistant' && !m.streaming).map((m) => m.text)

describe('a turn claude starts on its own', () => {
  it('is saved, pushed to every window, says what it waits on between turns, and asks for attention', async () => {
    const { chat: c, pushed, seen, space } = chat()
    await c.send('run it in the background')
    await vi.waitFor(() => { expect(done(pushed)).toEqual(['Started it in the background.', 'The background task finished.']) }, 8000)
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
    const { chat: c, pushed, space } = chat()
    await c.send('run it in the background')
    await vi.waitFor(() => { expect(done(pushed)).toHaveLength(1) }, 5000)
    await vi.waitFor(() => { expect(c.busy).toBe(true) }, 5000)
    space.setAttention(null)
    await vi.waitFor(() => { expect(done(pushed)).toHaveLength(2) }, 5000)
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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ResidentMessage } from '@shared/domain/residents'
import { ResidentChat } from '../../../src/main/residents/residentChat'
import { ResidentSpace } from '../../../src/main/residents/residentSpace'

/** A real login shell running tests/fixtures/fake-claude-chat.mjs, which speaks claude's stream-json. */
const FAKE = resolve(__dirname, '../../fixtures/fake-claude-chat.mjs')

const dirs: string[] = []
const chats: ResidentChat[] = []
afterEach(async () => {
  await Promise.all(chats.splice(0).map((c) => c.stop()))
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'apiary-resident-'))
  dirs.push(dir)
  return dir
}

function chat(dir: string): { chat: ResidentChat; pushed: ResidentMessage[]; activities: (string | null)[]; space: ResidentSpace } {
  const space = new ResidentSpace(dir, 'regent')
  const pushed: ResidentMessage[] = []
  const activities: (string | null)[] = []
  const c: ResidentChat = new ResidentChat({
    space,
    name: () => 'Regent',
    claudeBin: () => FAKE,
    env: () => ({}),
    launch: async () => ({
      mcpConfig: space.writeMcpConfig('http://127.0.0.1:1/mcp', 'token'), model: 'sonnet', systemPrompt: 'You are Regent.', permissionMode: 'manual',
    }),
    titleOf: () => null,
    onMessage: (m) => { pushed.push(m) },
    onActivity: () => { activities.push(c.activity()) },
  })
  chats.push(c)
  return { chat: c, pushed, activities, space }
}

const answered = (pushed: ResidentMessage[]): ResidentMessage | undefined => pushed.find((m) => m.role === 'assistant' && !m.streaming)

describe('ResidentChat', () => {
  it('history persists across restart and the sid is resumed', async () => {
    const dir = root()
    const first = chat(dir)
    await first.chat.send('hello')
    await vi.waitFor(() => { expect(answered(first.pushed)?.text).toBe('You said: hello') }, 5000)
    const sid = first.space.claudeSessionId()
    expect(sid).toMatch(/^[0-9a-f-]{36}$/)
    await first.chat.stop()

    const second = chat(dir)
    expect(second.chat.history().map((m) => [m.role, m.text])).toEqual([['user', 'hello'], ['assistant', 'You said: hello']])
    await second.chat.send('again')
    await vi.waitFor(() => { expect(answered(second.pushed)?.text).toBe('You said: again') }, 5000)
    // The fake answers under the session it was told to resume; a fresh start would mint a new one.
    expect(second.space.claudeSessionId()).toBe(sid)
    expect(second.chat.history()).toHaveLength(4)
  })

  it('writes its MCP config where only its owner can read it, in a folder only its owner can enter', async () => {
    const { chat: c, pushed, space } = chat(root())
    await c.send('hi')
    await vi.waitFor(() => { expect(answered(pushed)).toBeDefined() }, 5000)
    expect(statSync(join(space.dir, 'mcp.json')).mode & 0o777).toBe(0o600)
    expect(statSync(space.dir).mode & 0o777).toBe(0o700)
    expect(readFileSync(join(space.dir, 'mcp.json'), 'utf8')).toContain('Bearer token')
  })

  it('activity follows tool use', async () => {
    const { chat: c, pushed, activities } = chat(root())
    await c.send('find the auth work')
    await vi.waitFor(() => { expect(answered(pushed)).toBeDefined() }, 5000)
    const seen = activities.filter((a) => a !== null)
    expect(seen.indexOf('Searching sessions')).toBeGreaterThanOrEqual(0)
    expect(seen.indexOf('Writing')).toBeGreaterThan(seen.indexOf('Searching sessions'))
    expect(c.activity()).toBeNull()
    expect(c.busy).toBe(false)
  })

  it('a shell command is "Running …", thinking is "Thinking", and a turn with only text is "Writing"', async () => {
    const shell = chat(root())
    await shell.chat.send('run this in the background')
    await vi.waitFor(() => { expect(shell.activities).toContain('Running sleep 1') }, 5000)

    const text = chat(root())
    await text.chat.send('hello')
    await vi.waitFor(() => { expect(answered(text.pushed)).toBeDefined() }, 5000)
    const seen = text.activities.filter((a) => a !== null)
    expect(seen).toEqual(['Thinking', 'Writing'])
  })

  it('streams the answer as one message, then saves it whole', async () => {
    const { chat: c, pushed } = chat(root())
    await c.send('stream this')
    await vi.waitFor(() => { expect(answered(pushed)).toBeDefined() }, 5000)
    const ids = new Set(pushed.filter((m) => m.role === 'assistant').map((m) => m.id))
    expect(ids.size).toBe(1)
  })

  it('clear forgets history and sid', async () => {
    const dir = root()
    const { chat: c, pushed, space } = chat(dir)
    await c.send('hello')
    await vi.waitFor(() => { expect(answered(pushed)).toBeDefined() }, 5000)
    await c.clear()
    expect(c.history()).toEqual([])
    expect(space.claudeSessionId()).toBeNull()
    expect(new ResidentSpace(dir, 'regent').loadHistory()).toEqual([])
  })

  it('a can_use_tool request is listed until it is allowed; the allow reply lets the tool run', async () => {
    const { chat: c, pushed } = chat(root())
    await c.send('needs permission')
    await vi.waitFor(() => { expect(c.permissions()).toHaveLength(1) }, 5000)
    const [request] = c.permissions()
    expect(request).toMatchObject({ tool: 'Bash', summary: 'Run: echo fake-ran' })
    expect(c.busy).toBe(true)
    c.answerPermission(request.requestId, true)
    expect(c.permissions()).toEqual([])
    await vi.waitFor(() => { expect(answered(pushed)?.text).toBe('The command ran.') }, 5000)
  })

  it('a deny reply tells claude the user declined', async () => {
    const { chat: c, pushed } = chat(root())
    await c.send('needs permission')
    await vi.waitFor(() => { expect(c.permissions()).toHaveLength(1) }, 5000)
    c.answerPermission(c.permissions()[0].requestId, false)
    await vi.waitFor(() => { expect(answered(pushed)?.text).toBe('Understood, I did not run it.') }, 5000)
    // An id already answered is ignored.
    c.answerPermission('gone', true)
  })

  it('set_activity words show during a turn, and appendAssistant adds a finished message', async () => {
    const { chat: c, pushed } = chat(root())
    c.setOwnActivity('ignored with no turn')
    expect(c.activity()).toBeNull()
    await c.send('needs permission')
    await vi.waitFor(() => { expect(c.permissions()).toHaveLength(1) }, 5000)
    c.setOwnActivity('Checking the merge requests on the desk now')
    expect(c.activity()).toBe('Checking the merge requests on the desk…')
    c.answerPermission(c.permissions()[0].requestId, true)
    await vi.waitFor(() => { expect(c.busy).toBe(false) }, 5000)
    c.appendAssistant('| MR | state |')
    expect(pushed.at(-1)).toMatchObject({ role: 'assistant', text: '| MR | state |', streaming: false })
    expect(c.history().at(-1)?.text).toBe('| MR | state |')
  })

  it('a crash mid-turn adds the stopped message, and the next send restarts it', async () => {
    const { chat: c, pushed } = chat(root())
    await c.send('crash please')
    await vi.waitFor(() => { expect(answered(pushed)?.text).toContain('Regent stopped unexpectedly: fatal: the fake fell over') }, 5000)
    expect(c.busy).toBe(false)
    await c.send('hello again')
    await vi.waitFor(() => { expect(pushed.some((m) => m.role === 'assistant' && m.text === 'You said: hello again')).toBe(true) }, 5000)
  })
})

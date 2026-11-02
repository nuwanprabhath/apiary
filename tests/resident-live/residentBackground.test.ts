import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResidentMessage } from '@shared/domain/residents'
import { ResidentChat } from '../../src/main/residents/residentChat'
import { ResidentSpace } from '../../src/main/residents/residentSpace'

const LIVE = process.env.APIARY_LIVE_CLAUDE === '1'

const dirs: string[] = []
const chats: ResidentChat[] = []
afterEach(async () => {
  await Promise.all(chats.splice(0).map((c) => c.stop()))
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

const BASH = 'Run `sleep 15; echo finished` in the background with run_in_background, tell me you started it, then when it finishes tell me the word it printed.'
// The MR desk's own path: a review subagent run in the background, its report arriving after the turn that started it.
const AGENT = 'Start one Agent (subagent_type general-purpose, model haiku) with run_in_background true, asking it to run `sleep 10` and then reply with the word finished. Tell me you started it; when it reports back, tell me the word it replied with.'

describe.skipIf(!LIVE)('a resident on the real claude', () => {
  it.each([['a background shell command', BASH], ['a background subagent', AGENT]])('keeps the answer claude writes on its own when %s ends', async (_what, prompt) => {
    const dir = mkdtempSync(join(tmpdir(), 'apiary-resident-live-'))
    dirs.push(dir)
    const space = new ResidentSpace(dir, 'regent')
    const pushed: ResidentMessage[] = []
    const seen: { working: boolean; busy: boolean; activity: string | null }[] = []
    const c: ResidentChat = new ResidentChat({
      space,
      name: () => 'Live',
      claudeBin: () => 'claude',
      env: () => ({}),
      launch: async () => ({
        mcpConfig: space.writeMcpConfig('http://127.0.0.1:1/mcp', 'token'),
        model: 'claude-haiku-5-5',
        systemPrompt: 'You are a test resident. Be brief.',
        permissionMode: 'auto',
      }),
      titleOf: () => null,
      onMessage: (m) => { pushed.push(m) },
      onActivity: () => {
        seen.push({ working: c.working, busy: c.busy, activity: c.activity() })
        // Whatever the classifier asks about (the sleep), the person allows.
        for (const p of c.permissions()) c.answerPermission(p.requestId, true)
      },
    })
    chats.push(c)
    const answers = (): ResidentMessage[] => pushed.filter((m) => m.role === 'assistant' && !m.streaming)

    await c.send(prompt)
    await vi.waitFor(() => { expect(answers().length).toBeGreaterThanOrEqual(1) }, { timeout: 120_000, interval: 250 })
    await vi.waitFor(() => { expect(answers().some((m) => /finished/i.test(m.text) && m !== answers()[0])).toBe(true) }, { timeout: 180_000, interval: 500 })
    await vi.waitFor(() => { expect(c.busy).toBe(false) }, { timeout: 60_000, interval: 250 })

    expect(seen.some((s) => s.working && !s.busy && s.activity !== null)).toBe(true)
    const later = answers().slice(1).find((m) => /finished/i.test(m.text))
    expect(later).toBeDefined()
    expect(c.history().some((m) => m.id === later?.id)).toBe(true)
    expect(readFileSync(join(space.dir, 'history.json'), 'utf8')).toContain(later?.id ?? 'missing')
    expect(space.attention()).not.toBeNull()
  })
})

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountId } from '@shared/domain/ids'
import type { DigestLookback } from '@shared/domain/residents'
import type { OneShotRequest } from '../../../src/main/claude/claudeOneShot'
import { Digester, type DigestableSession } from '../../../src/main/knowledge/digester'
import { KnowledgeStore } from '../../../src/main/knowledge/knowledgeStore'

const line = (role: 'user' | 'assistant', text: string): string =>
  JSON.stringify({ type: role, message: { role, content: [{ type: 'text', text }] } })

const answer = (topics: unknown[]): string => JSON.stringify({ structured_output: { topics } })

describe('Digester', () => {
  let dir: string
  let store: KnowledgeStore
  let prompts: string[]
  let reply: (req: OneShotRequest, call: number) => string | Promise<string>
  let envs: (Record<string, string> | undefined)[]
  let clock: number
  let sessions: DigestableSession[]
  let digester: Digester
  let waits: number

  const file = (name: string, lines: string[]): string => {
    const path = join(dir, `${name}.jsonl`)
    writeFileSync(path, `${lines.join('\n')}\n`)
    return path
  }
  const session = (id: string, lastActive: number, lines: string[], cwd: string | null = '/work/proj'): DigestableSession => {
    const s = { sessionId: id, file: file(id, lines), cwd, lastActive }
    sessions.push(s)
    return s
  }
  const topicFor = (req: OneShotRequest): unknown[] => {
    const nums = [...req.prompt.matchAll(/^(\d+): /gm)].map((m) => Number(m[1]))
    return [{ title: `Topic ${String(nums[0])}`, summary: 's', keywords: ['k'], refs: [], startLine: nums[0], endLine: nums[nums.length - 1] }]
  }
  const run = async (opts: { shouldPause?: () => boolean; lookback?: DigestLookback | null } = {}): Promise<void> => {
    digester.resume({ model: 'haiku', lookback: opts.lookback ?? null, shouldPause: opts.shouldPause ?? (() => false) })
    await digester.idle()
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'apiary-digester-'))
    store = new KnowledgeStore(join(dir, 'knowledge.db'))
    prompts = []
    envs = []
    sessions = []
    clock = 1_000_000
    waits = 0
    reply = (req) => answer(topicFor(req))
    digester = new Digester({
      store,
      sessions: () => sessions,
      runner: {
        run: async (req) => {
          prompts.push(req.prompt)
          envs.push(req.env)
          return reply(req, prompts.length)
        },
      },
      accounts: { launchEnv: (id) => ({ CLAUDE_CONFIG_DIR: `/acct/${id}` }), defaultId: () => 'main' as AccountId },
      residentsDir: join(dir, 'residents'),
      now: () => clock,
      wait: async () => { waits += 1 },
    })
  })
  afterEach(() => {
    store.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('digests newest first, under the default account', async () => {
    session('old', 100, [line('user', 'OLDSESSION talk')])
    session('new', 900, [line('user', 'NEWSESSION talk')])
    await run()
    expect(prompts.map((p) => (p.includes('NEWSESSION') ? 'new' : 'old'))).toEqual(['new', 'old'])
    expect(envs[0]).toEqual({ CLAUDE_CONFIG_DIR: '/acct/main' })
    expect(digester.progress()).toEqual({ done: 2, total: 2 })
  })

  it('the lookback skips sessions last active before it, and progress counts only those inside', async () => {
    const DAY = 24 * 60 * 60 * 1000
    clock = 100 * DAY
    session('recent', clock - 2 * DAY, [line('user', 'RECENT talk')])
    session('edge', clock - 7 * DAY, [line('user', 'EDGE talk')])
    session('old', clock - 8 * DAY, [line('user', 'OLD talk')])
    await run({ lookback: { amount: 1, unit: 'weeks' } })
    expect(prompts.map((p) => /(RECENT|EDGE|OLD)/.exec(p)?.[1])).toEqual(['RECENT', 'EDGE'])
    expect(digester.progress()).toEqual({ done: 2, total: 2 })
    expect(digester.indexSize()).toEqual({ sessions: 2, topics: 2 })
    // A wider lookback reaches the rest on the next pass, with nothing digested again.
    await run({ lookback: { amount: 1, unit: 'months' } })
    expect(prompts).toHaveLength(3)
    expect(digester.progress()).toEqual({ done: 3, total: 3 })
  })

  it('a second pass digests only lines after last_line', async () => {
    const s = session('a', 1, [line('user', 'FIRSTPART'), line('assistant', 'reply')])
    await run()
    appendFileSync(s.file, `${line('user', 'SECONDPART')}\n`)
    await run()
    expect(prompts).toHaveLength(2)
    expect(prompts[1]).toContain('3: User: SECONDPART')
    expect(prompts[1]).not.toContain('FIRSTPART')
    expect(store.state('a')?.lastLine).toBe(3)
    expect(store.topicsOf('a').map((t) => t.startLine)).toEqual([1, 3])
  })

  it('an unchanged session is not opened', async () => {
    session('a', 1, [line('user', 'hello')])
    await run()
    await run()
    expect(prompts).toHaveLength(1)
  })

  it('pause stops after the current window', async () => {
    const big = 'x'.repeat(3500)
    session('a', 1, Array.from({ length: 25 }, (_, i) => line(i % 2 === 0 ? 'user' : 'assistant', `${big}${String(i)}`)))
    reply = (req) => {
      digester.pause()
      return answer(topicFor(req))
    }
    await run()
    expect(prompts).toHaveLength(1)
    expect(store.state('a')?.lastLine).toBeLessThan(25)
    expect(store.state('a')?.size).toBe(0)
  })

  it('shouldPause holds the queue', async () => {
    session('a', 1, [line('user', 'hello')])
    let checks = 0
    await run({ shouldPause: () => { checks += 1; return checks <= 3 } })
    expect(waits).toBe(3)
    expect(prompts).toHaveLength(1)
  })

  it('a failed session waits a day', async () => {
    session('a', 1, [line('user', 'hello')])
    reply = () => { throw new Error('boom') }
    await run()
    expect(prompts).toHaveLength(1)
    expect(store.state('a')?.failedAt).toBe(clock)

    reply = (req) => answer(topicFor(req))
    clock += 60 * 60 * 1000
    await run()
    expect(prompts).toHaveLength(1)

    clock += 24 * 60 * 60 * 1000
    await run()
    expect(prompts).toHaveLength(2)
    expect(store.state('a')?.failedAt).toBeNull()
  })

  it("the residents' own sessions are skipped", async () => {
    const residents = join(dir, 'residents', 'regent')
    mkdirSync(residents, { recursive: true })
    session('regent-chat', 500, [line('user', 'RESIDENT')], residents)
    session('mine', 1, [line('user', 'MINE')])
    await run()
    expect(prompts).toHaveLength(1)
    expect(prompts[0]).toContain('MINE')
    expect(digester.progress().total).toBe(1)
  })

  it('invalid topics are dropped', async () => {
    session('a', 1, [line('user', 'one'), line('assistant', 'two'), line('user', 'three')])
    reply = () => answer([
      { title: '', summary: 'no title', keywords: [], refs: [], startLine: 1, endLine: 2 },
      { summary: 'missing title', startLine: 1, endLine: 2 },
      { title: 'Kept', summary: 'y'.repeat(900), keywords: ['a', 7], refs: ['!5'], startLine: -4, endLine: 99 },
    ])
    await run()
    const topics = store.topicsOf('a')
    expect(topics).toHaveLength(1)
    expect(topics[0]).toMatchObject({ title: 'Kept', startLine: 1, endLine: 3, keywords: ['a'], refs: ['!5'] })
    expect(topics[0].summary).toHaveLength(600)
  })
})

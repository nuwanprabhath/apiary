import { describe, expect, it, vi } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ResidentConfig, SessionHit } from '@shared/domain/residents'
import { FRIDAY, build, children, dir, regent, spawned } from './support'

describe('ResidentService', () => {
  it('on duty resumes the digest and off duty pauses it', async () => {
    vi.setSystemTime(FRIDAY(17, 59))
    const { service, digest } = build([regent()])
    service.start()
    expect(digest.calls).toEqual(['resume:haiku'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(digest.calls).toEqual(['resume:haiku', 'pause'])
    expect(service.list()[0]).toMatchObject({ onDuty: false, state: 'asleep' })
  })

  it('pauses the digest at the usage limit, and never without usage data', () => {
    vi.setSystemTime(FRIDAY(12))
    const over = build([regent()], { usage: 70 })
    over.service.start()
    expect(over.digest.shouldPause?.()).toBe(true)
    const unknown = build([regent({ id: 'regent' })], { usage: null })
    unknown.service.start()
    expect(unknown.digest.shouldPause?.()).toBe(false)
  })

  it('disabled is asleep', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { service, digest } = build([regent({ enabled: false })])
    service.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(service.list()[0]).toMatchObject({ enabled: false, state: 'asleep', activity: null, onDuty: true })
    expect(digest.calls).toEqual([])
    expect(spawned).toEqual([])
    await expect(service.send('regent', 'hello')).rejects.toThrow(/not enabled/)
  })

  it('status broadcasts on change', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { service, digest, changes } = build([regent()])
    service.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(changes).toHaveLength(1)
    expect(changes[0][0]).toMatchObject({ id: 'regent', state: 'idle', onDuty: true, appearance: { glyph: 'bee' }, digest: { done: 1, total: 3 } })
    digest.emit('Digesting 1/3')
    await vi.advanceTimersByTimeAsync(100)
    expect(changes).toHaveLength(2)
    expect(changes[1][0]).toMatchObject({ state: 'working', activity: 'Digesting 1/3' })
    digest.emit('Digesting 1/3')
    await vi.advanceTimersByTimeAsync(100)
    expect(changes).toHaveLength(2)
  })

  it('warm-starts claude on duty in a private space, with the user\'s tools, Apiary\'s added and chat-mode permissions', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { service } = build([regent()])
    service.start()
    await vi.waitFor(() => { expect(spawned).toHaveLength(1) })
    const command = spawned[0].join(' ')
    expect(command).toContain('--model sonnet')
    expect(command).toContain('--allowedTools mcp__apiary__*')
    expect(command).toContain('--permission-mode auto --permission-prompt-tool stdio')
    expect(command).not.toContain('--strict-mcp-config')
    expect(command).not.toContain('--tools ')
    expect(command).toContain(`--mcp-config ${join(dir, 'regent', 'mcp.json')}`)
    expect(statSync(join(dir, 'regent')).mode & 0o777).toBe(0o700)
  })

  it('adds a resident with the kind\'s defaults and a fresh id', () => {
    vi.setSystemTime(FRIDAY(12))
    const { service, settings } = build([])
    service.start()
    expect(service.add('regent')).toMatchObject({ id: 'regent', name: 'Regent', enabled: false, model: 'sonnet' })
    expect(service.add('regent').id).toBe('regent-2')
    expect(settings.list.map((c) => c.id)).toEqual(['regent', 'regent-2'])
    expect(service.list().map((s) => s.id)).toEqual(['regent', 'regent-2'])
  })

  it('refuses an empty or oversized message and an unknown resident', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { service } = build([regent()])
    service.start()
    await expect(service.send('regent', '   ')).rejects.toThrow()
    await expect(service.send('regent', 'x'.repeat(8001))).rejects.toThrow()
    await expect(service.send('ghost', 'hi')).rejects.toThrow(/No resident/)
  })

  it('passes the lookback to the digest; a change resumes it with the new one', () => {
    vi.setSystemTime(FRIDAY(12))
    const { service, settings, digest } = build([regent({ digestLookback: { amount: 2, unit: 'weeks' } })])
    service.start()
    settings.change([regent({ digestLookback: null })])
    expect(digest.calls).toEqual(['resume:haiku:2weeks', 'resume:haiku'])
  })

  it('a quick-action command runs in the space with the kind\'s env, and its output is added to the chat', async () => {
    vi.setSystemTime(FRIDAY(12))
    const runs: { argv: string[]; cwd: string; env: Record<string, string> }[] = []
    const { service } = build([regent({ options: { project: 'grp/app' } })], {
      kinds: {
        quickActions: [
          { id: 'desk', label: 'Get the desk', doing: 'Reading the desk', run: { kind: 'command', argv: ['{bin:mra}', 'desk', '{option:project}'] } },
          { id: 'broken', label: 'Broken', doing: 'Breaking', run: { kind: 'command', argv: ['{bin:nope}'] } },
        ],
        bins: { mra: () => ['python3', '/res/mra'] },
        env: (_c, space) => ({ MRA_CONFIG: join(space, 'mra.toml') }),
      },
      run: async (argv, cwd, env) => { runs.push({ argv, cwd, env }); return '| MR | state |\n' },
    })
    service.start()
    expect(service.list()[0].quickActions).toEqual([{ id: 'desk', label: 'Get the desk' }, { id: 'broken', label: 'Broken' }])
    await service.quickAction('regent', 'desk')
    expect(runs).toEqual([{ argv: ['python3', '/res/mra', 'desk', 'grp/app'], cwd: join(dir, 'regent'), env: { MRA_CONFIG: join(dir, 'regent', 'mra.toml') } }])
    await service.quickAction('regent', 'broken')
    expect(service.history('regent').map((m) => [m.role, m.text])).toEqual([
      ['user', 'Get the desk'], ['assistant', '| MR | state |'], ['user', 'Broken'], ['assistant', '**Broken** failed: Unknown program: nope'],
    ])
    await expect(service.quickAction('regent', 'ghost')).rejects.toThrow(/no action/)
  })

  it('a can_use_tool request shows in the status with attention, and the answer goes back to claude', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { service } = build([regent()])
    service.start()
    await service.send('regent', 'check the MR')
    await vi.waitFor(() => { expect(children).toHaveLength(1) })
    children[0].stdout.write(`${JSON.stringify({
      type: 'control_request', request_id: 'req-1',
      request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'glab mr view 12' }, permission_suggestions: [] },
    })}\n`)
    await vi.waitFor(() => { expect(service.list()[0].permissions).toHaveLength(1) })
    expect(service.list()[0]).toMatchObject({
      permissions: [{ requestId: 'req-1', tool: 'Bash', summary: 'Run: glab mr view 12' }],
      attention: { count: 1, summary: 'Waiting for your OK' },
    })
    service.answerPermission('regent', 'req-1', true)
    expect(JSON.parse(children[0].written.at(-1) ?? '{}')).toEqual({
      type: 'control_response',
      response: { subtype: 'success', request_id: 'req-1', response: { behavior: 'allow', updatedInput: { command: 'glab mr view 12' } } },
    })
    expect(service.list()[0]).toMatchObject({ permissions: [], attention: null })
  })

  it('attention set over MCP persists across a restart and clears when seen; apiary_status reports progress', async () => {
    // Real HTTP needs real timers; the clock is kept on duty by a schedule that covers every day.
    vi.useRealTimers()
    const always = { days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }
    const onDuty = (over: Partial<ResidentConfig> = {}): ResidentConfig => regent({ schedule: always, ...over })
    const first = build([onDuty({ digestLookback: { amount: 1, unit: 'months' } })])
    first.service.start()
    await vi.waitFor(() => { expect(spawned).toHaveLength(1) })
    const call = callMcp(join(dir, 'regent', 'mcp.json'))
    await call('set_attention', { count: 2, summary: 'MRs waiting' })
    expect(first.service.list()[0].attention).toEqual({ count: 2, summary: 'MRs waiting' })
    const status = await call('apiary_status', {})
    expect(status).toContain('Digest: 1/3 sessions this pass, looking back 1 month.')
    expect(status).toContain('Index: 40 sessions digested, 160 topics.')
    expect(status).toContain('Your attention flag: 2: MRs waiting.')
    expect(status).not.toContain('Cycle:')
    await first.service.dispose()

    const desk = build([onDuty({ id: 'desk', cycleEveryMinutes: 10 })], { kinds: { cycle: { everyMinutes: 15, prompt: 'cycle', doing: 'Checking' } } })
    desk.service.start()
    await vi.waitFor(() => { expect(spawned).toHaveLength(2) })
    const deskStatus = await callMcp(join(dir, 'desk', 'mcp.json'))('apiary_status', {})
    expect(deskStatus).toMatch(/Cycle: Apiary runs it every 10 minutes during your hours; next at \d\d:\d\d; none is running now\./)
    await desk.service.dispose()

    const second = build([onDuty()])
    second.service.start()
    expect(second.service.list()[0].attention).toEqual({ count: 2, summary: 'MRs waiting' })
    second.service.seen('regent')
    expect(second.service.list()[0].attention).toBeNull()
  })

  it('a cycle prompt goes when due, not while a turn runs, and never while setup is needed', async () => {
    vi.setSystemTime(FRIDAY(12))
    const { service } = build([regent()], { kinds: { cycle: { everyMinutes: 1, prompt: 'check the desk', doing: 'Checking' } } })
    service.start()
    await vi.advanceTimersByTimeAsync(60_000)
    const cycles = (): number => service.history('regent').filter((m) => m.text === 'check the desk').length
    await vi.waitFor(() => { expect(cycles()).toBe(1) })
    // The quiet claude never ends the turn, so the next cycle finds it busy.
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(cycles()).toBe(1)

    const unset = build([regent({ id: 'other' })], { kinds: { cycle: { everyMinutes: 1, prompt: 'check', doing: 'Checking' }, setup: () => 'Set the project' } })
    unset.service.start()
    await vi.advanceTimersByTimeAsync(3 * 60_000)
    expect(unset.service.history('other')).toEqual([])
    expect(unset.service.list()[0].setupNeeded).toBe('Set the project')
  })

  it('a cycle\'s nextAt follows the setting, and Check now sends the cycle prompt', async () => {
    vi.setSystemTime(FRIDAY(12))
    const desk = (over: Partial<ResidentConfig> = {}): ResidentConfig => regent({ id: 'desk', kind: 'mr-desk', ...over })
    const { service, settings } = build([desk()], { kinds: { setup: () => null, prepare: undefined } })
    service.start()
    expect(service.list()[0].cycle).toEqual({ everyMinutes: 15, nextAt: FRIDAY(12, 15).getTime(), running: false })
    settings.change([desk({ cycleEveryMinutes: 30 })])
    expect(service.list()[0].cycle).toEqual({ everyMinutes: 30, nextAt: FRIDAY(12, 30).getTime(), running: false })
    vi.setSystemTime(FRIDAY(19))
    settings.change([desk({ cycleEveryMinutes: 30 })])
    // Off duty on Friday evening: the first cycle is 30 minutes after Monday 09:00.
    expect(service.list()[0].cycle?.nextAt).toBe(new Date(2026, 10, 2, 9, 30).getTime())

    vi.setSystemTime(FRIDAY(12))
    settings.change([desk()])
    await service.quickAction('desk', 'cycle')
    expect(service.history('desk').map((m) => m.text)).toContain('Run one MR desk cycle.')
    expect(service.list()[0].cycle?.running).toBe(true)
  })

  it('options changed while prepare runs are prepared as soon as it finishes, not at the next re-check', async () => {
    vi.setSystemTime(FRIDAY(12))
    const desk = (options: Record<string, string>): ResidentConfig => regent({ id: 'desk', kind: 'mr-desk', options })
    let finish = (): void => {}
    const prepare = vi.fn((_config: ResidentConfig, _space: string) => new Promise<void>((resolve) => { finish = resolve }))
    const { service, settings } = build([desk({})], { kinds: { setup: () => null, prepare } })
    service.start()
    settings.change([desk({ project: 'g/p' })])
    settings.change([desk({ project: 'g/p', repoPath: '/code/p' })])
    finish()
    await vi.advanceTimersByTimeAsync(10)
    expect(prepare.mock.calls.at(-1)?.[0].options).toEqual({ project: 'g/p', repoPath: '/code/p' })
  })

  it('a working resident always says what it is doing; the MR desk gets no instant matches', async () => {
    vi.setSystemTime(FRIDAY(12))
    const find = vi.fn(async (): Promise<SessionHit[]> => [])
    const knowledge = { find, topics: async () => [], read: async () => null }
    const { service } = build([regent(), regent({ id: 'desk', kind: 'mr-desk' })], { knowledge, kinds: { setup: () => null, prepare: undefined } })
    service.start()
    expect(await service.send('desk', 'find the session for !1175')).toEqual([])
    await service.send('regent', 'Can you check it now?')
    expect(find).not.toHaveBeenCalled()
    for (const s of service.list()) {
      expect(s.state).toBe('working')
      expect(s.activity).toBe('Working')
    }
    await service.send('regent', 'Open the session for !1175')
    expect(find).toHaveBeenCalledTimes(1)
  })

  it('a folder option is stored only for a folder field of the kind', () => {
    vi.setSystemTime(FRIDAY(12))
    const { service, settings } = build([regent()], {
      kinds: { optionFields: [{ key: 'clone', label: 'Clone', help: '', input: 'folder', required: true }] },
    })
    service.start()
    expect(service.setFolderOption('regent', 'clone', '/work/app')).toBe('/work/app')
    expect(settings.list[0].options).toEqual({ clone: '/work/app' })
    expect(() => { service.setFolderOption('regent', 'project', '/x') }).toThrow(/no folder option/)
  })
})

/** Calls one Apiary tool the way the resident's claude would: the URL and token from its mcp.json. */
function callMcp(file: string): (name: string, args: unknown) => Promise<string> {
  const config = JSON.parse(readFileSync(file, 'utf8')) as { mcpServers: { apiary: { url: string; headers: Record<string, string> } } }
  const { url, headers } = config.mcpServers.apiary
  return async (name, args) => {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    })
    const body = await res.json() as { result: { content: { text: string }[] } }
    return body.result.content[0].text
  }
}

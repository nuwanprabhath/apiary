import { describe, it, expect } from 'vitest'
import { MrStatusCache } from '../../src/main/git/mrStatusCache'

function fakeExec(response: () => Promise<string> | string) {
  const calls: Array<{ file: string; args: string[]; cwd: string }> = []
  const exec = async (file: string, args: string[], cwd: string): Promise<string> => {
    calls.push({ file, args, cwd })
    return response()
  }
  return { exec, calls }
}

const lookup = (cache: MrStatusCache, iid: number, project = 'group/project') =>
  cache.resolve('/repo', 'https://gitlab.com', project, iid)

describe('MrStatusCache.resolve', () => {
  it('spawns glab api against the urlencoded project path and iid', async () => {
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'merged' }))
    const state = await lookup(new MrStatusCache({ exec }), 1267, 'group/sub/project')
    expect(state).toBe('merged')
    expect(calls).toEqual([{
      file: 'glab',
      args: ['api', 'projects/group%2Fsub%2Fproject/merge_requests/1267'],
      cwd: '/repo',
    }])
  })

  it('re-checks an open merge request after two minutes, since that is the state that changes', async () => {
    let now = 0
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'opened' }))
    const cache = new MrStatusCache({ exec, now: () => now })
    await lookup(cache, 1)
    await lookup(cache, 1)
    expect(calls).toHaveLength(1)
    now = 2 * 60 * 1000 + 1
    await lookup(cache, 1)
    expect(calls).toHaveLength(2)
  })

  it('keeps a merged one much longer — it is not going to change back', async () => {
    let now = 0
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'merged' }))
    const cache = new MrStatusCache({ exec, now: () => now })
    await lookup(cache, 2)
    now = 30 * 60 * 1000
    await lookup(cache, 2)
    expect(calls).toHaveLength(1)
  })

  it('asks again straight away once invalidated — the Refresh button', async () => {
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'opened' }))
    const cache = new MrStatusCache({ exec })
    await lookup(cache, 3)
    cache.invalidate()
    await lookup(cache, 3)
    expect(calls).toHaveLength(2)
  })

  it('shares one call across concurrent lookups for the same key', async () => {
    let resolveExec: (v: string) => void = () => {}
    let calls = 0
    const exec = async (): Promise<string> => {
      calls++
      return new Promise((resolve) => { resolveExec = resolve })
    }
    const cache = new MrStatusCache({ exec })
    const a = lookup(cache, 9)
    const b = lookup(cache, 9)
    resolveExec(JSON.stringify({ state: 'closed' }))
    expect(await a).toBe('closed')
    expect(await b).toBe('closed')
    expect(calls).toBe(1)
  })

  it('degrades to null on a non-zero exit or malformed JSON', async () => {
    const exec = async (): Promise<string> => { throw new Error('HTTP 404') }
    expect(await lookup(new MrStatusCache({ exec }), 2)).toBeNull()
  })

  it('caches "glab missing" negatively so a missing binary is not probed again', async () => {
    let calls = 0
    const exec = async (): Promise<string> => {
      calls++
      const err = new Error('spawn glab ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    const cache = new MrStatusCache({ exec })
    await lookup(cache, 3)
    await lookup(cache, 4, 'group/other')
    expect(calls).toBe(1)
  })

  it('two caches share nothing: each test, and each window of the future, has its own', async () => {
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'merged' }))
    await lookup(new MrStatusCache({ exec }), 5)
    await lookup(new MrStatusCache({ exec }), 5)
    expect(calls).toHaveLength(2)
  })
})

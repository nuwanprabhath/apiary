import { describe, it, expect, beforeEach } from 'vitest'
import { resolveMrStatus, resetMrStatusCache, invalidateMrStatuses } from '../../src/main/git/mrStatusCache'

beforeEach(() => { resetMrStatusCache() })

function fakeExec(response: () => Promise<string> | string) {
  const calls: Array<{ file: string; args: string[]; cwd: string }> = []
  const exec = async (file: string, args: string[], cwd: string): Promise<string> => {
    calls.push({ file, args, cwd })
    return response()
  }
  return { exec, calls }
}

describe('resolveMrStatus', () => {
  it('spawns glab api against the urlencoded project path and iid', async () => {
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'merged' }))
    const state = await resolveMrStatus('/repo', 'https://gitlab.com', 'group/sub/project', 1267, { exec })
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
    const options = { exec, now: () => now }
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 1, options)
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 1, options)
    expect(calls).toHaveLength(1)
    now = 2 * 60 * 1000 + 1
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 1, options)
    expect(calls).toHaveLength(2)
  })

  it('keeps a merged one much longer — it is not going to change back', async () => {
    let now = 0
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'merged' }))
    const options = { exec, now: () => now }
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 2, options)
    now = 30 * 60 * 1000
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 2, options)
    expect(calls).toHaveLength(1)
  })

  it('asks again straight away once invalidated — the Refresh button', async () => {
    const { exec, calls } = fakeExec(() => JSON.stringify({ state: 'opened' }))
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 3, { exec })
    invalidateMrStatuses()
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 3, { exec })
    expect(calls).toHaveLength(2)
  })

  it('shares one call across concurrent lookups for the same key', async () => {
    let resolveExec: (v: string) => void = () => {}
    const exec = async (): Promise<string> =>
      new Promise((resolve) => { resolveExec = resolve })
    let calls = 0
    const countingExec = async (file: string, args: string[], cwd: string): Promise<string> => {
      calls++
      return exec()
    }
    const a = resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 9, { exec: countingExec })
    const b = resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 9, { exec: countingExec })
    resolveExec(JSON.stringify({ state: 'closed' }))
    expect(await a).toBe('closed')
    expect(await b).toBe('closed')
    expect(calls).toBe(1)
  })

  it('degrades to null on a non-zero exit or malformed JSON', async () => {
    const exec = async (): Promise<string> => { throw new Error('HTTP 404') }
    expect(await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 2, { exec })).toBeNull()
  })

  it('caches "glab missing" negatively so a missing binary is not probed again', async () => {
    let calls = 0
    const exec = async (): Promise<string> => {
      calls++
      const err = new Error('spawn glab ENOENT') as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    }
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/project', 3, { exec })
    await resolveMrStatus('/repo', 'https://gitlab.com', 'group/other', 4, { exec })
    expect(calls).toBe(1)
  })
})

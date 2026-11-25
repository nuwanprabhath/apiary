import { describe, expect, it, vi } from 'vitest'
import { createGitLabMrPlugin } from '../../src/main/plugins/gitlabMr'
import type { PluginContext } from '../../src/main/plugins/types'

const ctx: PluginContext = { cwd: '/w', branch: 'feat', remoteUrl: async () => 'git@gitlab.com:group/proj.git' }

describe('GitLab MR plugin and Settings → Privacy', () => {
  it('never calls glab while lookups are not allowed, and offers the MR form', async () => {
    const exec = vi.fn(async () => '[]')
    const item = await createGitLabMrPlugin({ exec, allowed: () => false }).evaluate(ctx, {})
    expect(exec).not.toHaveBeenCalled()
    expect(item?.id).toBe('mr-new')
  })

  it('counts an allowed() that throws as not allowed', async () => {
    const exec = vi.fn(async () => '[]')
    await createGitLabMrPlugin({ exec, allowed: () => { throw new Error('boom') } }).evaluate(ctx, {})
    expect(exec).not.toHaveBeenCalled()
  })

  it('asks glab when allowed', async () => {
    const exec = vi.fn(async () => '[]')
    await createGitLabMrPlugin({ exec, allowed: () => true }).evaluate(ctx, {})
    expect(exec).toHaveBeenCalledTimes(1)
  })
})

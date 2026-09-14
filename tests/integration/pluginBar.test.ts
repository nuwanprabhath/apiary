import { describe, it, expect, vi } from 'vitest'
import { PluginRegistry } from '../../src/main/plugins/registry'
import { createGitLabMrPlugin, pickMergeRequest } from '../../src/main/plugins/gitlabMr'
import type { PluginBarItem, SessionBarPlugin } from '../../src/main/plugins/types'

/** A `glab`/`git` stand-in: answers are looked up by the command being run. */
function fakeExec(answers: Record<string, string | Error>) {
  const calls: string[][] = []
  const exec = async (file: string, args: string[]): Promise<string> => {
    calls.push([file, ...args])
    const key = [file, ...args].join(' ')
    const match = Object.entries(answers).find(([pattern]) => key.includes(pattern))
    if (match === undefined) throw new Error(`unexpected command: ${key}`)
    if (match[1] instanceof Error) throw match[1]
    return match[1]
  }
  return { exec, calls }
}

const REMOTE = 'git@gitlab.com:ternandsparrow/paratoo-fdcp.git'
const ctx = { cwd: '/work/repo', branch: 'camera-trap-dropdown' }

function mr(over: Partial<{ iid: number; state: string; title: string; draft: boolean }> = {}) {
  return {
    iid: 1255,
    state: 'opened',
    title: 'fix(cypress): wait for the filter signal',
    web_url: 'https://gitlab.com/ternandsparrow/paratoo-fdcp/-/merge_requests/1255',
    ...over,
  }
}

describe('pickMergeRequest', () => {
  it('prefers an open merge request over a merged one on the same branch', () => {
    const merged = mr({ iid: 1300, state: 'merged' })
    const open = mr({ iid: 1255, state: 'opened' })
    // Not simply the newest: a branch with a stale merged MR and a live open one is being worked
    // in the open one, whichever was created first.
    expect(pickMergeRequest([merged, open])?.iid).toBe(1255)
  })

  it('takes the most recent when several are open', () => {
    expect(pickMergeRequest([mr({ iid: 10 }), mr({ iid: 42 })])?.iid).toBe(42)
  })

  it('falls back to a merged one when nothing is open, since that is where the branch went', () => {
    expect(pickMergeRequest([mr({ iid: 7, state: 'merged' })])?.iid).toBe(7)
  })

  it('is null for a branch with no merge requests', () => {
    expect(pickMergeRequest([])).toBeNull()
  })
})

describe('the GitLab merge-request plugin', () => {
  it('shows the merge request number, and opens it when clicked', async () => {
    const { exec } = fakeExec({
      'git remote get-url': REMOTE,
      'glab mr list': JSON.stringify([mr()]),
    })
    const item = await createGitLabMrPlugin({ exec }).evaluate(ctx, {})

    expect(item?.label).toBe('!1255')
    expect(item?.action).toEqual({
      kind: 'open-url',
      url: 'https://gitlab.com/ternandsparrow/paratoo-fdcp/-/merge_requests/1255',
    })
    expect(item?.title).toContain('fix(cypress)')
  })

  it('says when the merge request is a draft, which changes whether it is ready to look at', async () => {
    const { exec } = fakeExec({
      'git remote get-url': REMOTE,
      'glab mr list': JSON.stringify([mr({ draft: true })]),
    })
    expect((await createGitLabMrPlugin({ exec }).evaluate(ctx, {}))?.title).toContain('Draft')
  })

  it('asks about the branch it was given, not whatever glab thinks is current', async () => {
    const { exec, calls } = fakeExec({
      'git remote get-url': REMOTE,
      'glab mr list': '[]',
    })
    await createGitLabMrPlugin({ exec }).evaluate(ctx, {})
    expect(calls.some((c) => c.includes('--source-branch') && c.includes('camera-trap-dropdown')))
      .toBe(true)
  })

  it('offers to create one when the branch has none', async () => {
    const { exec } = fakeExec({ 'git remote get-url': REMOTE, 'glab mr list': '[]' })
    const item = await createGitLabMrPlugin({ exec }).evaluate(ctx, {})

    expect(item?.label).toBe('MR')
    expect(item?.action).toEqual({
      kind: 'open-url',
      url: 'https://gitlab.com/ternandsparrow/paratoo-fdcp/-/merge_requests/new'
        + '?merge_request%5Bsource_branch%5D=camera-trap-dropdown',
    })
  })

  it('still offers to create one when glab is missing entirely', async () => {
    // The useful half of the button needs nothing but the remote — no CLI, no token, no network.
    const { exec } = fakeExec({
      'git remote get-url': REMOTE,
      'glab mr list': new Error('spawn glab ENOENT'),
    })
    expect((await createGitLabMrPlugin({ exec }).evaluate(ctx, {}))?.id).toBe('mr-new')
  })

  it('shows nothing at all for a repository that is not on GitLab', async () => {
    const { exec } = fakeExec({ 'git remote get-url': 'git@github.com:someone/thing.git' })
    expect(await createGitLabMrPlugin({ exec }).evaluate(ctx, {})).toBeNull()
  })

  it('shows nothing for a folder with no git remote', async () => {
    const { exec } = fakeExec({ 'git remote get-url': new Error('not a git repository') })
    expect(await createGitLabMrPlugin({ exec }).evaluate(ctx, {})).toBeNull()
  })

  it('shows nothing on a detached HEAD, which has no branch to have an MR for', async () => {
    const { exec, calls } = fakeExec({ 'git remote get-url': REMOTE })
    expect(await createGitLabMrPlugin({ exec }).evaluate({ cwd: '/work/repo', branch: null }, {}))
      .toBeNull()
    // And it does not go looking, either.
    expect(calls).toEqual([])
  })

  it('survives glab returning something that is not a merge request list', async () => {
    const { exec } = fakeExec({ 'git remote get-url': REMOTE, 'glab mr list': 'not json at all' })
    expect((await createGitLabMrPlugin({ exec }).evaluate(ctx, {}))?.id).toBe('mr-new')
  })
})

/** A plugin that returns a fixed item, counting how many times it was asked. */
function stubPlugin(id: string, item: PluginBarItem | null): SessionBarPlugin & { calls: number } {
  const plugin = {
    id,
    name: id,
    calls: 0,
    async evaluate(): Promise<PluginBarItem | null> { plugin.calls += 1; return item },
  }
  return plugin
}

const barItem = (pluginId: string): PluginBarItem => ({
  pluginId, id: 'x', icon: 'link', label: 'L', title: 'T', action: { kind: 'none' },
})

describe('the plugin registry', () => {
  it('collects what every enabled plugin contributes', async () => {
    const registry = new PluginRegistry()
    registry.register(stubPlugin('a', barItem('a')))
    registry.register(stubPlugin('b', barItem('b')))

    const items = await registry.refresh(ctx)
    expect(items.map((i) => i.pluginId)).toEqual(['a', 'b'])
  })

  it('contains a plugin that throws, so the others still contribute', async () => {
    // The bar carries git state that matters; an integration failing to reach its API must not
    // take that down with it.
    const registry = new PluginRegistry()
    registry.register({
      id: 'bad',
      name: 'bad',
      evaluate: async () => { throw new Error('API is down') },
    })
    registry.register(stubPlugin('good', barItem('good')))

    const items = await registry.refresh(ctx)
    expect(items.map((i) => i.pluginId)).toEqual(['good'])
  })

  it('leaves a disabled plugin unasked, rather than asking and discarding', async () => {
    const registry = new PluginRegistry()
    const plugin = stubPlugin('a', barItem('a'))
    registry.register(plugin, false)

    expect(await registry.refresh(ctx)).toEqual([])
    expect(plugin.calls).toBe(0)
  })

  it('answers from cache, so redrawing the bar does not hit the network', async () => {
    const registry = new PluginRegistry({ ttlMs: 1000, now: () => 1000 })
    const plugin = stubPlugin('a', barItem('a'))
    registry.register(plugin)

    await registry.refresh(ctx)
    for (let i = 0; i < 20; i += 1) registry.items(ctx)
    expect(plugin.calls).toBe(1)
  })

  it('looks again once the cached answer is old', async () => {
    let now = 1000
    const registry = new PluginRegistry({ ttlMs: 500, now: () => now })
    const plugin = stubPlugin('a', barItem('a'))
    registry.register(plugin)

    await registry.refresh(ctx)
    now += 600
    registry.items(ctx)
    await vi.waitFor(() => { expect(plugin.calls).toBe(2) })
  })

  it('caches per branch, so switching branches asks again', async () => {
    const registry = new PluginRegistry({ ttlMs: 10_000, now: () => 1000 })
    const plugin = stubPlugin('a', barItem('a'))
    registry.register(plugin)

    await registry.refresh(ctx)
    await registry.refresh({ ...ctx, branch: 'another-branch' })
    expect(plugin.calls).toBe(2)
  })

  it('returns the stale answer while a refresh runs, rather than blanking the bar', async () => {
    let now = 1000
    const registry = new PluginRegistry({ ttlMs: 100, now: () => now })
    registry.register(stubPlugin('a', barItem('a')))

    await registry.refresh(ctx)
    now += 500
    // Expired, but there is a previous answer: the bar keeps it until the new one arrives.
    expect(registry.items(ctx).map((i) => i.pluginId)).toEqual(['a'])
  })

  it('announces a change only when the bar would actually look different', async () => {
    const onChanged = vi.fn()
    const registry = new PluginRegistry({ ttlMs: 0, onChanged })
    registry.register(stubPlugin('a', barItem('a')))

    await registry.refresh(ctx)
    expect(onChanged).toHaveBeenCalledTimes(1)
    await registry.refresh(ctx)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('forgets what it cached when a plugin is switched off', async () => {
    const registry = new PluginRegistry({ ttlMs: 10_000, now: () => 1000 })
    registry.register(stubPlugin('a', barItem('a')))

    await registry.refresh(ctx)
    registry.setEnabled('a', false)
    expect(await registry.refresh(ctx)).toEqual([])
  })
})

describe('plugin settings', () => {
  it('targets the branch the setting names, when creating a merge request', async () => {
    const { exec } = fakeExec({ 'git remote get-url': REMOTE, 'glab mr list': '[]' })
    const item = await createGitLabMrPlugin({ exec })
      .evaluate(ctx, { targetBranch: 'dev/1.0.12' })

    const url = new URL((item?.action as { url: string }).url)
    expect(url.searchParams.get('merge_request[target_branch]')).toBe('dev/1.0.12')
    expect(url.searchParams.get('merge_request[source_branch]')).toBe('camera-trap-dropdown')
    // And says so before it is clicked, rather than being a surprise on GitLab's form.
    expect(item?.title).toContain('dev/1.0.12')
  })

  it('leaves the target out entirely when the setting is blank, so GitLab picks its default', async () => {
    // An empty `target_branch` parameter is not the same as no parameter: GitLab would take the
    // empty string as the answer rather than falling back to the project's default branch.
    const { exec } = fakeExec({ 'git remote get-url': REMOTE, 'glab mr list': '[]' })
    for (const blank of ['', '   ']) {
      const item = await createGitLabMrPlugin({ exec }).evaluate(ctx, { targetBranch: blank })
      expect((item?.action as { url: string }).url).not.toContain('target_branch')
    }
  })

  it('fills in a plugin\'s declared defaults, so it never has to check for absence', () => {
    const registry = new PluginRegistry()
    registry.register(createGitLabMrPlugin())
    expect(registry.settingsFor('gitlab-mr')).toEqual({ targetBranch: '' })
  })

  it('ignores a stored value of the wrong type, which settings.json can be edited to hold', () => {
    const registry = new PluginRegistry()
    registry.register(createGitLabMrPlugin())
    registry.setSettings('gitlab-mr', { targetBranch: 42 as unknown as string })
    expect(registry.settingsFor('gitlab-mr')).toEqual({ targetBranch: '' })
  })

  it('hands each plugin its own settings and nobody else\'s', async () => {
    const seen: Record<string, unknown> = {}
    const registry = new PluginRegistry()
    for (const id of ['a', 'b']) {
      registry.register({
        id,
        name: id,
        settings: [{ kind: 'string', key: 'value', label: 'v', default: '' }],
        evaluate: async (_ctx, settings) => { seen[id] = settings; return null },
      })
    }
    registry.setSettings('a', { value: 'for-a' })
    registry.setSettings('b', { value: 'for-b' })

    await registry.refresh(ctx)
    expect(seen).toEqual({ a: { value: 'for-a' }, b: { value: 'for-b' } })
  })

  it('looks again when a setting changes, rather than serving the old answer', async () => {
    const registry = new PluginRegistry({ ttlMs: 10_000, now: () => 1000 })
    const plugin = stubPlugin('a', barItem('a'))
    registry.register({ ...plugin, settings: [{ kind: 'string', key: 'v', label: 'v', default: '' }] })

    await registry.refresh(ctx)
    registry.items(ctx)
    expect(plugin.calls).toBe(1)

    registry.setSettings('a', { v: 'changed' })
    registry.items(ctx)
    await vi.waitFor(() => { expect(plugin.calls).toBe(2) })
  })

  it('lists what each plugin declares, so Settings can draw it without knowing the plugin', () => {
    const registry = new PluginRegistry()
    registry.register(createGitLabMrPlugin())
    const [entry] = registry.list()

    expect(entry.id).toBe('gitlab-mr')
    expect(entry.description).toBeTruthy()
    expect(entry.fields.map((f) => f.key)).toEqual(['targetBranch'])
    expect(entry.values).toEqual({ targetBranch: '' })
  })
})

describe('changing a setting while the bar is on screen', () => {
  it('keeps showing the old answer until the new one is ready, rather than blinking out', async () => {
    // Clearing the cache would leave the bar empty for as long as the lookup takes, and — worse —
    // during that gap a click would still carry the URL computed under the old setting.
    const registry = new PluginRegistry({ ttlMs: 10_000, now: () => 1000 })
    registry.register({
      id: 'a',
      name: 'a',
      settings: [{ kind: 'string', key: 'v', label: 'v', default: '' }],
      evaluate: async (_ctx, settings) => ({
        ...barItem('a'), label: String(settings.v ?? ''),
      }),
    })

    await registry.refresh(ctx)
    registry.setSettings('a', { v: 'new' })

    // Whatever is on screen is still a real button, at every instant.
    expect(registry.items(ctx)).toHaveLength(1)
    await vi.waitFor(() => { expect(registry.items(ctx)[0].label).toBe('new') })
  })

  it('a refresh asked for during a lookup joins it instead of getting the stale answer', async () => {
    const registry = new PluginRegistry({ ttlMs: 0 })
    // Held in an object: TypeScript narrows a `let` that is only ever assigned inside a callback
    // to `never`, and the point of this test is calling it from outside.
    const gate: { release: (() => void) | null } = { release: null }
    registry.register({
      id: 'slow',
      name: 'slow',
      evaluate: async () => {
        await new Promise<void>((r) => { gate.release = r })
        return barItem('slow')
      },
    })

    const first = registry.refresh(ctx)
    const second = registry.refresh(ctx)
    await vi.waitFor(() => { expect(gate.release).not.toBeNull() })
    gate.release?.()

    expect(await second).toEqual(await first)
    expect((await second).map((i) => i.pluginId)).toEqual(['slow'])
  })
})

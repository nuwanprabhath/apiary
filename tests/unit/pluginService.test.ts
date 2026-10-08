import { describe, it, expect } from 'vitest'
import { PluginService, type PluginServiceDeps } from '../../src/main/plugins/pluginService'
import { PluginRegistry } from '../../src/main/plugins/registry'
import { StatusBarRegistry } from '../../src/main/statusBar/registry'
import type { StatusBarPlugin } from '../../src/main/statusBar/types'
import type { SessionBarPlugin } from '../../src/main/plugins/types'
import { asSessionId } from '@shared/domain/ids'

const SESSION = asSessionId('11111111-1111-4111-8111-111111111111')

const barPlugin = (id: string): SessionBarPlugin => ({
  id, name: id, evaluate: async () => [{ pluginId: id, id: 'b', label: id, title: id, action: { kind: 'open-url', url: 'https://example.test' } }],
} as unknown as SessionBarPlugin)

const statusPlugin = (id: string): StatusBarPlugin => ({
  id, name: id, start: () => {}, stop: () => {}, items: () => [], refresh: async () => {},
})

function build(resolve: () => string = () => '/work', builtins?: PluginServiceDeps['builtins']) {
  const plugins = new PluginRegistry({ remoteUrl: async () => null })
  const statusBar = new StatusBarRegistry()
  const service = new PluginService({
    plugins, statusBar,
    resolver: { resolveShellCwd: resolve } as unknown as PluginServiceDeps['resolver'],
    git: { lastBranchFor: () => 'main' } as unknown as PluginServiceDeps['git'],
    ...(builtins !== undefined ? { builtins } : {}),
  })
  return { service, plugins, statusBar }
}

describe('PluginService', () => {
  it('lists the session-bar and status-bar plugins together and routes enable/settings to the registry that owns the id', () => {
    const { service, plugins, statusBar } = build()
    plugins.register(barPlugin('bar'), true)
    statusBar.register(statusPlugin('status'), true)
    expect(service.list().map((p) => p.id)).toEqual(['bar', 'status'])
    service.setEnabled('status', false)
    service.setEnabled('bar', false)
    expect(statusBar.isEnabled('status')).toBe(false)
    expect(service.list().map((p) => [p.id, p.enabled])).toEqual([['bar', false], ['status', false]])
  })

  it('a session whose folder has gone has no bar items, instead of an error', async () => {
    const { service } = build(() => { throw new Error('gone') })
    expect(service.barItems({ kind: 'session', id: SESSION })).toEqual([])
    expect(await service.refreshBar({ kind: 'session', id: SESSION })).toEqual([])
  })

  it('registers the built-ins only when asked, with the user\'s own enablement winning over the default', () => {
    expect(build().service.list()).toEqual([])
    const { service } = build(undefined, {
      enabled: { 'gitlab-mr': false }, settings: undefined, glabPath: undefined, configRoot: '/nowhere', useKeychain: false,
    })
    const ids = service.list().map((p) => [p.id, p.enabled])
    expect(ids).toContainEqual(['gitlab-mr', false])
    expect(service.list().length).toBeGreaterThan(1) // the status-bar built-ins come with it
  })
})

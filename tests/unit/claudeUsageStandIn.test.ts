import { describe, it, expect } from 'vitest'
import { PluginService } from '../../src/main/plugins/pluginService'
import { PluginRegistry } from '../../src/main/plugins/registry'
import { StatusBarRegistry } from '../../src/main/statusBar/registry'
import { parseRuntimeEnv } from '../../src/main/app/env'

/** `APIARY_FAKE_USAGE` lets the README screenshot show usage with no real sign-in and no network. */
describe('APIARY_FAKE_USAGE', () => {
  const json = JSON.stringify({ five_hour: { utilization: 37 }, seven_day: { utilization: 12 } })

  it('is read when unpackaged and ignored when packaged', () => {
    expect(parseRuntimeEnv({ APIARY_FAKE_USAGE: json }, [], false).fakeUsage).toBe(json)
    expect(parseRuntimeEnv({ APIARY_FAKE_USAGE: json }, [], true).fakeUsage).toBeUndefined()
  })

  it('makes the usage plugin show the given numbers without asking for consent', async () => {
    const statusBar = new StatusBarRegistry({ onChanged: () => {} })
    const service = new PluginService({
      plugins: new PluginRegistry({ onChanged: () => {} }), statusBar,
      resolver: {} as never, git: {} as never,
      builtins: { enabled: undefined, settings: undefined, glabPath: undefined, configRoot: '/nonexistent', useKeychain: false, accounts: null, fakeUsage: json },
    })
    service.startStatusBar()
    await expect.poll(() => statusBar.items().map((i) => i.text).join('|')).toMatch(/5h 37% · 7d 12%/)
  })
})

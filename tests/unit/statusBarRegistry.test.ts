import { describe, it, expect } from 'vitest'
import { StatusBarRegistry } from '../../src/main/statusBar/registry'
import type { StatusBarPlugin } from '../../src/main/statusBar/types'

function plugin(id: string, over: Partial<StatusBarPlugin> = {}): StatusBarPlugin & { starts: number; stops: number } {
  const p = {
    id, name: id, starts: 0, stops: 0,
    start() { p.starts++ },
    stop() { p.stops++ },
    items: () => [{ id: 'x', text: id, title: id, tone: 'normal' as const, action: { kind: 'none' as const }, detail: [] }],
    refresh: async () => {},
    ...over,
  }
  return p
}

describe('StatusBarRegistry', () => {
  it('runs enabled plugins only, and switching one off stops it and removes its items', () => {
    let changed = 0
    const reg = new StatusBarRegistry({ onChanged: () => { changed++ } })
    const on = plugin('on')
    const off = plugin('off')
    reg.register(on, true)
    reg.register(off, false)
    reg.start()
    expect(reg.items().map((i) => i.pluginId)).toEqual(['on'])
    expect(off.starts).toBe(0)
    reg.setEnabled('on', false)
    expect(on.stops).toBe(1)
    expect(reg.items()).toEqual([])
    expect(changed).toBe(1)
  })

  it('a plugin that throws contributes nothing and disturbs nothing else', async () => {
    const reg = new StatusBarRegistry()
    reg.register(plugin('bad', { items: () => { throw new Error('boom') }, refresh: async () => { throw new Error('boom') } }), true)
    reg.register(plugin('good'), true)
    reg.start()
    expect(reg.items().map((i) => i.pluginId)).toEqual(['good'])
    await expect(reg.refresh('bad')).resolves.toBeUndefined()
  })

  it('shares the Plugins settings shape: fields, defaults filled in, and a restart on change', () => {
    const reg = new StatusBarRegistry()
    const p = plugin('p', { settings: [{ kind: 'number', key: 'n', label: 'N', default: 5 }] })
    reg.register(p, true)
    reg.start()
    expect(reg.list()[0]).toMatchObject({ id: 'p', enabled: true, values: { n: 5 } })
    reg.setSettings('p', { n: 7 })
    expect(reg.settingsFor('p')).toEqual({ n: 7 })
    expect(p.starts).toBe(2)
  })
})

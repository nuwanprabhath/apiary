import { describe, it, expect, vi } from 'vitest'
import type { RemoteHost } from '@shared/domain/remote'
import { remoteSessionItems } from '../../src/main/app/remoteSessionMenu'

const host = (name: string, status: RemoteHost['status']): RemoteHost => ({ name, source: 'recent', status })

describe('File → Open Remote Session', () => {
  it('lists each host from the cache with its state, then a separator and Other Host…', () => {
    const items = remoteSessionItems(
      [host('work-box', 'ready'), host('lab', 'off'), host('locked', 'refused'), host('gone', 'unreachable'), host('new', 'unknown')], () => undefined, () => undefined,
    )
    expect(items.map((i) => i.type === 'separator' ? '---' : i.label)).toEqual([
      'work-box', 'lab — remote access off', 'locked — login refused', 'gone — unreachable', 'new', '---', 'Other Host…',
    ])
  })

  it('shows only Other Host… when nothing is listed', () => {
    expect(remoteSessionItems([], () => undefined, () => undefined).map((i) => i.label)).toEqual(['Other Host…'])
  })

  it('connects to the chosen host, and Other Host… opens the dialog', () => {
    const open = vi.fn()
    const other = vi.fn()
    const items = remoteSessionItems([host('work-box', 'ready')], open, other)
    items[0].click?.(null as never, undefined, null as never)
    items[2].click?.(null as never, undefined, null as never)
    expect(open).toHaveBeenCalledWith('work-box')
    expect(other).toHaveBeenCalledTimes(1)
  })
})

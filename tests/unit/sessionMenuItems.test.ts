import { describe, it, expect, vi } from 'vitest'
import { asSessionId } from '@shared/domain/ids'
import { sessionMenuItems } from '../../src/renderer/features/sidebar/sidebarMenuItems'

const id = asSessionId('s1')
const menu = { kind: 'session' as const, id, x: 0, y: 0 }
const items = (pinned: string[]) => sessionMenuItems(menu, {
  tree: [], pinned, onForkSession: vi.fn(), onReorderPinned: vi.fn(), onTogglePin: vi.fn(), requestPicker: vi.fn(),
}).map((i) => i.id)

describe('sessionMenuItems pin entries', () => {
  it('a pinned session offers Unpin and the move items', () => {
    const ids = items(['s1', 's2'])
    expect(ids).toContain('unpin')
    expect(ids).toContain('pinned-move-up')
    expect(ids).toContain('pinned-move-down')
    expect(ids).not.toContain('pin')
  })
  it('an unpinned session offers Pin and no move items', () => {
    const ids = items(['s2'])
    expect(ids).toContain('pin')
    expect(ids).not.toContain('unpin')
    expect(ids).not.toContain('pinned-move-up')
  })
})

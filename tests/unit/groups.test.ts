import { describe, it, expect } from 'vitest'
import {
  orderFolders, groupFolders, moveFolder, moveBefore, moveGroup, deleteGroup, newGroupId,
} from '../../src/renderer/state/groups'
import type { SessionGroup } from '../../src/renderer/state/groups'

const id = (p: string): string => p

describe('orderFolders', () => {
  it('puts folders in the arrangement the user dragged them into', () => {
    expect(orderFolders(['a', 'b', 'c'], id, ['c', 'a'])).toEqual(['c', 'a', 'b'])
  })

  it('sorts an unseen folder to the bottom rather than into the middle of an arrangement', () => {
    // 'new' has never been dragged, so it must not land between two folders that were placed
    // deliberately — an arrangement made before it existed still means what it meant.
    expect(orderFolders(['a', 'new', 'b'], id, ['b', 'a'])).toEqual(['b', 'a', 'new'])
  })

  it('keeps unseen folders in their existing relative order', () => {
    expect(orderFolders(['x', 'y', 'z'], id, [])).toEqual(['x', 'y', 'z'])
  })
})

describe('groupFolders', () => {
  const groups: SessionGroup[] = [{ id: 'g1', name: 'Unwanted' }, { id: 'g2', name: 'Active' }]

  it('files folders under their group, leaving the rest ungrouped', () => {
    const result = groupFolders(['bil', 'comb3', 'paratoo'], id, groups,
      { bil: 'g1', comb3: 'g1' }, [])
    expect(result.groups[0].group.name).toBe('Unwanted')
    expect(result.groups[0].folders).toEqual(['bil', 'comb3'])
    expect(result.groups[1].folders).toEqual([])
    expect(result.ungrouped).toEqual(['paratoo'])
  })

  it('treats an assignment to a deleted group as ungrouped, not as a missing folder', () => {
    const result = groupFolders(['bil'], id, groups, { bil: 'gone' }, [])
    expect(result.ungrouped).toEqual(['bil'])
    expect(result.groups.every((g) => g.folders.length === 0)).toBe(true)
  })

  it('applies the user ordering inside a group as well as outside it', () => {
    const result = groupFolders(['a', 'b'], id, groups, { a: 'g1', b: 'g1' }, ['b', 'a'])
    expect(result.groups[0].folders).toEqual(['b', 'a'])
  })
})

describe('moveFolder', () => {
  it('moves a folder to sit where the one it was dropped on was', () => {
    expect(moveFolder([], ['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
  })

  it('works when neither folder has ever been dragged before', () => {
    // The stored order starts empty, so this has to fall back to the folders as they come.
    expect(moveFolder([], ['paratoo-fdcp', 'bil', 'comb3'], 'comb3', 'paratoo-fdcp'))
      .toEqual(['comb3', 'paratoo-fdcp', 'bil'])
  })

  it('leaves the order alone when the drop target is unknown', () => {
    expect(moveFolder(['a', 'b'], ['a', 'b'], 'a', 'nope')).toEqual(['a', 'b'])
  })
})

describe('moveBefore', () => {
  it('reorders pinned ids by dropping one onto another', () => {
    expect(moveBefore(['x', 'y', 'z'], 'z', 'x')).toEqual(['z', 'x', 'y'])
    expect(moveBefore(['x', 'y', 'z'], 'x', 'z')).toEqual(['y', 'x', 'z'])
  })

  it('ignores ids that are not in the list', () => {
    expect(moveBefore(['x', 'y'], 'q', 'x')).toEqual(['x', 'y'])
    expect(moveBefore(['x', 'y'], 'x', 'q')).toEqual(['x', 'y'])
  })
})

describe('moveGroup', () => {
  const groups: SessionGroup[] = [
    { id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' },
  ]

  it('moves a group up and down', () => {
    expect(moveGroup(groups, 'c', -1).map((g) => g.id)).toEqual(['a', 'c', 'b'])
    expect(moveGroup(groups, 'a', 1).map((g) => g.id)).toEqual(['b', 'a', 'c'])
  })

  it('does nothing at the ends, rather than wrapping around', () => {
    expect(moveGroup(groups, 'a', -1)).toBe(groups)
    expect(moveGroup(groups, 'c', 1)).toBe(groups)
  })
})

describe('deleteGroup', () => {
  it('frees its folders instead of taking them with it', () => {
    const groups: SessionGroup[] = [{ id: 'g1', name: 'Unwanted' }, { id: 'g2', name: 'Keep' }]
    const result = deleteGroup(groups, { bil: 'g1', comb3: 'g2' }, 'g1')
    expect(result.groups.map((g) => g.id)).toEqual(['g2'])
    // 'bil' is ungrouped now, and — importantly — still exists.
    expect(result.assignments).toEqual({ comb3: 'g2' })
  })
})

describe('newGroupId', () => {
  it('does not repeat, so two windows cannot mint the same group', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newGroupId()))
    expect(ids.size).toBe(200)
  })
})

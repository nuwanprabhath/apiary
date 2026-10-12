import { describe, it, expect } from 'vitest'
import {
  LIBRARY_STATE, isLibraryPatch, libraryDefaults, parseLibraryState, type LibraryKey,
} from '@shared/libraryState'

// "A mirrored preference" is one entry in `LIBRARY_STATE`. Every check here runs over every entry,
// so the next one is covered without a test of its own.

const keys = Object.keys(LIBRARY_STATE) as LibraryKey[]

describe('library state registry', () => {
  it('declares the sidebar arrangement, the per-chat settings and the tool-call default', () => {
    expect(keys).toEqual(expect.arrayContaining([
      'pinned', 'pinnedCollapsed', 'groups', 'groupAssignments', 'groupsCollapsed', 'folderOrder',
      'dismissedRecent', 'recentCollapsed', 'showAllWorktrees', 'createdWorktrees', 'chatSettings', 'hideToolCallIo',
    ]))
  })

  it('every default passes its own guard', () => {
    for (const k of keys) expect([k, LIBRARY_STATE[k].guard(LIBRARY_STATE[k].default)]).toEqual([k, true])
  })

  it('a patch with an unknown key is refused', () => {
    expect(isLibraryPatch({ pinned: ['a'], sidebarWidth: 300 })).toBe(false)
  })

  it('a patch with a wrong type is refused', () => {
    expect(isLibraryPatch({ pinned: 'a' })).toBe(false)
    expect(isLibraryPatch({ hideToolCallIo: 'yes' })).toBe(false)
    expect(isLibraryPatch({ groups: [{ id: 1, name: 'x' }] })).toBe(false)
    expect(isLibraryPatch({ chatSettings: { s1: { showToolCalls: 'no' } } })).toBe(false)
    expect(isLibraryPatch(null)).toBe(false)
    expect(isLibraryPatch([])).toBe(false)
  })

  it('a valid partial patch is accepted', () => {
    expect(isLibraryPatch({})).toBe(true)
    expect(isLibraryPatch({ groups: [{ id: 'g', name: 'Work' }], groupAssignments: { '/repo/a': 'g' }, hideToolCallIo: true })).toBe(true)
  })

  it('defaults fill missing fields, and a bad stored field falls back to its default', () => {
    const parsed = parseLibraryState({ pinned: ['s1'], hideToolCallIo: 'nope', stranger: 1 })
    expect(parsed).toEqual({ ...libraryDefaults(), pinned: ['s1'] })
    expect(parseLibraryState('garbage')).toEqual(libraryDefaults())
  })
})

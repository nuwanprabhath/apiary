import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { libraryDefaults, type LibrarySnapshot } from '@shared/libraryState'
import { LibraryStateService } from '../../src/main/library/libraryStateService'

let dir: string
let file: string
let heard: LibrarySnapshot[]

const build = (moved = {}): LibraryStateService =>
  new LibraryStateService({ file, moved, onChanged: (s) => { heard.push(s) } })

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'apiary-library-'))
  file = join(dir, 'library-state.json')
  heard = []
})
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('LibraryStateService', () => {
  it('starts with the defaults, unseeded', () => {
    expect(build().snapshot()).toEqual({ state: libraryDefaults(), seeded: false })
  })

  it('persists a patch, marks itself seeded and broadcasts the new snapshot', () => {
    const service = build()
    service.set({ groups: [{ id: 'g', name: 'Work' }], groupAssignments: { '/repo/a': 'g' } })
    expect(heard).toHaveLength(1)
    expect(heard[0]?.seeded).toBe(true)
    expect(heard[0]?.state.groups).toEqual([{ id: 'g', name: 'Work' }])
    const reread = build().snapshot()
    expect(reread.seeded).toBe(true)
    expect(reread.state.groupAssignments).toEqual({ '/repo/a': 'g' })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ seeded: true })
  })

  it('applies a seed once, and refuses every seed after', () => {
    const service = build()
    expect(service.seed({ pinned: ['s1'] }).state.pinned).toEqual(['s1'])
    expect(heard).toHaveLength(1)
    expect(service.seed({ pinned: ['home'] }).state.pinned).toEqual(['s1'])
    expect(heard).toHaveLength(1)
    expect(build().seed({ pinned: ['home'] }).state.pinned).toEqual(['s1'])
  })

  it('refuses a seed once anything has been set', () => {
    const service = build()
    service.set({ hideToolCallIo: true })
    service.seed({ hideToolCallIo: false, pinned: ['home'] })
    expect(service.snapshot().state).toMatchObject({ hideToolCallIo: true, pinned: [] })
  })

  it('takes a value moved out of settings.json without counting as seeded', () => {
    const service = build({ hideToolCallIo: true })
    expect(service.snapshot()).toMatchObject({ seeded: false, state: { hideToolCallIo: true } })
    expect(build().snapshot().state.hideToolCallIo).toBe(true)
  })
})

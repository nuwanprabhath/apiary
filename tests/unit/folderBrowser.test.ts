import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BROWSE_MAX_ENTRIES } from '@shared/domain/folders'
import { BROWSE_IDLE_MS, BROWSE_MAX_OPEN, FolderBrowser } from '../../src/main/folders/folderBrowser'

let root: string
let home: string
let outside: string
let clock: number
let browser: FolderBrowser

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'apiary-browse-')))
  home = join(root, 'home')
  outside = join(root, 'outside')
  for (const d of [home, outside]) mkdirSync(d)
  for (const d of ['beta', 'Alpha', 'gamma', '.hidden', 'repo/.git', 'Alpha/inner/deep']) mkdirSync(join(home, d), { recursive: true })
  writeFileSync(join(home, 'file.txt'), 'x')
  clock = 1_000
  browser = new FolderBrowser({ home, now: () => clock })
})
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

const names = (v: { entries: { name: string }[] }): string[] => v.entries.map((e) => e.name)

describe('folder browser listing', () => {
  it('lists folders only, sorted ignoring case, without dot-folders, marking repositories', async () => {
    const view = await browser.open()
    expect(names(view)).toEqual(['Alpha', 'beta', 'gamma', 'repo'])
    expect(view.entries.filter((e) => e.isRepo).map((e) => e.name)).toEqual(['repo'])
    expect(view.crumbs).toEqual(['~'])
    expect(view.atRoot).toBe(true)
    expect(view.id).toMatch(/^[0-9a-f]{32}$/)
  })

  it('cuts a folder with more than the cap', async () => {
    for (let i = 0; i < BROWSE_MAX_ENTRIES + 5; i++) mkdirSync(join(home, `many-${String(i).padStart(4, '0')}`))
    expect((await browser.open()).entries).toHaveLength(BROWSE_MAX_ENTRIES)
  })
})

describe('folder browser moves', () => {
  it('enters, goes up and jumps to a crumb, and tells the session folder', async () => {
    const { id } = await browser.open()
    await browser.enter(id, 'Alpha')
    const inner = await browser.enter(id, 'inner')
    expect(inner.crumbs).toEqual(['~', 'Alpha', 'inner'])
    expect(inner.atRoot).toBe(false)
    expect(names(inner)).toEqual(['deep'])
    expect(await browser.current(id)).toBe(join(home, 'Alpha', 'inner'))
    expect((await browser.up(id)).crumbs).toEqual(['~', 'Alpha'])
    await browser.enter(id, 'inner')
    expect((await browser.crumb(id, 1)).crumbs).toEqual(['~', 'Alpha'])
    const top = await browser.crumb(id, 0)
    expect(top.atRoot).toBe(true)
    expect(await browser.current(id)).toBe(home)
  })

  it('refuses up at home and a crumb that is not on the path', async () => {
    const { id } = await browser.open()
    await expect(browser.up(id)).rejects.toThrow(/top/)
    for (const index of [1, -1, 0.5, Number.NaN]) await expect(browser.crumb(id, index)).rejects.toThrow(/not a place/)
  })
})

describe('folder browser refused names', () => {
  it.each(['', '.', '..', 'a/b', 'a\\b', '../outside', 'missing', 'file.txt', '.hidden'])('refuses %j', async (name) => {
    const { id } = await browser.open()
    await expect(browser.enter(id, name)).rejects.toThrow()
    expect(await browser.current(id)).toBe(home)
  })
})

describe('folder browser symlink escape', () => {
  it('refuses a link that leads outside home, and follows one that stays inside', async () => {
    symlinkSync(outside, join(home, 'escape'))
    symlinkSync(join(home, 'beta'), join(home, 'shortcut'))
    const { id } = await browser.open()
    await expect(browser.enter(id, 'escape')).rejects.toThrow(/outside/)
    expect(await browser.current(id)).toBe(home)
    expect((await browser.enter(id, 'shortcut')).crumbs).toEqual(['~', 'shortcut'])
  })
})

describe('folder browser lifetime', () => {
  it('expires after ten idle minutes, and activity keeps it alive', async () => {
    const { id } = await browser.open()
    clock += BROWSE_IDLE_MS - 1
    await browser.enter(id, 'beta')
    clock += BROWSE_IDLE_MS - 1
    expect(await browser.current(id)).toBe(join(home, 'beta'))
    clock += BROWSE_IDLE_MS + 1
    await expect(browser.current(id)).rejects.toThrow(/closed/)
  })

  it('keeps at most twenty open, dropping the oldest first, and close ends one', async () => {
    const first = await browser.open()
    const ids = [first.id]
    for (let i = 1; i < BROWSE_MAX_OPEN; i++) ids.push((await browser.open()).id)
    const extra = await browser.open()
    await expect(browser.current(first.id)).rejects.toThrow(/closed/)
    expect(await browser.current(ids[1] ?? '')).toBe(home)
    browser.close(extra.id)
    await expect(browser.current(extra.id)).rejects.toThrow(/closed/)
    await expect(browser.current('nope')).rejects.toThrow(/closed/)
  })
})

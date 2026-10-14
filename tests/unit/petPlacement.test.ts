import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STARTER_PET } from '@shared/pets/builtins'
import type { PetArrival } from '@shared/pets/state'
import { PetStore } from '../../src/main/pets/petStore'
import { PetPlacement, type PetWindow } from '../../src/main/pets/petPlacement'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apiary-pet-place-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

/** A window with the number `n`, its webContents id `n * 10`, its content area 20px below its top. */
function win(n: number, x: number, opts: { remote?: boolean; visible?: boolean } = {}): PetWindow {
  const bounds = { x, y: 0, width: 400, height: 300 }
  return {
    number: n, webContentsId: n * 10, remote: opts.remote ?? false, visible: opts.visible ?? true,
    bounds, content: { ...bounds, y: 20, height: 280 }, focus: vi.fn(),
  }
}

function world(windows: PetWindow[], focusOrder: number[] = windows.map((w) => w.webContentsId)) {
  const store = new PetStore(join(dir, 'pets.json'))
  const arrivals: Omit<PetArrival, 'seq'>[] = []
  const changed = vi.fn()
  const cursor = { x: 0, y: 0 }
  const placement = new PetPlacement({
    store, windows: () => windows, focusOrder: () => focusOrder, cursor: () => cursor,
    arrive: (a) => { arrivals.push(a) }, changed,
  })
  return { store, placement, arrivals, changed, cursor, windows }
}

describe('PetPlacement', () => {
  it('puts a pet made active in the window that asked', () => {
    const { store, placement } = world([win(1, 0), win(2, 500)])
    const pet = store.add(STARTER_PET)
    placement.adopt(20)
    expect(store.get(pet.id)?.window).toBe(2)
    store.update(pet.id, { active: false })
    store.update(pet.id, { active: true })
    placement.activated(pet.id, 10)
    expect(store.get(pet.id)?.window).toBe(1)
  })

  it('puts a pet asked for by a remote window, or by no window, in the most recently focused local one', () => {
    const { store, placement } = world([win(1, 0), win(2, 500), win(3, 900, { remote: true })], [30, 20, 10])
    const a = store.add(STARTER_PET)
    placement.adopt(30)
    expect(store.get(a.id)?.window).toBe(2)
    const b = store.add(STARTER_PET)
    placement.adopt(999)
    expect(store.get(b.id)?.window).toBe(2)
  })

  it('leaves a pet whose window is still open where it is when another window adopts', () => {
    const { store, placement } = world([win(1, 0), win(2, 500)])
    const pet = store.assign(store.add(STARTER_PET).id, 1)
    placement.adopt(20)
    expect(store.get(pet.id)?.window).toBe(1)
  })

  it('once started, gives an unassigned pet (a record from before windows) or one whose window is gone to the most recently focused window', () => {
    const { store, placement, changed } = world([win(1, 0), win(2, 500)], [20, 10])
    const old = store.add(STARTER_PET)
    const stranded = store.assign(store.add(STARTER_PET).id, 7)
    const home = store.assign(store.add(STARTER_PET).id, 1)
    placement.rehome()
    expect(store.get(old.id)?.window).toBeNull() // not before the startup restore has opened every window
    placement.start()
    expect([store.get(old.id)?.window, store.get(stranded.id)?.window, store.get(home.id)?.window]).toEqual([2, 2, 1])
    expect(changed).toHaveBeenCalled()
  })

  it('moves a closed window\'s pets to the most recently focused other window', () => {
    const windows = [win(1, 0), win(2, 500), win(3, 900)]
    const { store, placement } = world(windows, [10, 30, 20])
    placement.start()
    const pet = store.assign(store.add(STARTER_PET).id, 1)
    const other = store.assign(store.add(STARTER_PET).id, 2)
    windows.splice(0, 1)
    placement.windowClosed(1, { quitting: false })
    expect(store.get(pet.id)?.window).toBe(3)
    expect(store.get(other.id)?.window).toBe(2)
  })

  it('keeps a closing window\'s pets in it when the app is quitting, so the restore puts them back', () => {
    const windows = [win(1, 0), win(2, 500)]
    const { store, placement } = world(windows)
    placement.start()
    const pet = store.assign(store.add(STARTER_PET).id, 1)
    windows.splice(0, 1)
    placement.windowClosed(1, { quitting: true })
    expect(store.get(pet.id)?.window).toBe(1)
  })

  describe('a pet dropped outside its window', () => {
    it('moves to the other window under the pointer, lands at the point in that window\'s coordinates, and that window is focused', () => {
      const { store, placement, arrivals, cursor, windows } = world([win(1, 0), win(2, 500)])
      const pet = store.assign(store.add(STARTER_PET).id, 1)
      Object.assign(cursor, { x: 600, y: 250 })
      expect(placement.dropOutside(pet.id, 10)).toBe(true)
      expect(store.get(pet.id)?.window).toBe(2)
      expect(arrivals).toEqual([{ id: pet.id, window: 2, x: 100, y: 230 }])
      expect(windows[1].focus).toHaveBeenCalled()
    })

    it('stays when released over no window, over its own, over a hidden one or over a remote one', () => {
      const { store, placement, arrivals, cursor } = world([win(1, 0), win(2, 500, { visible: false }), win(3, 1000, { remote: true })])
      const pet = store.assign(store.add(STARTER_PET).id, 1)
      for (const at of [{ x: 2000, y: 50 }, { x: 100, y: 100 }, { x: 600, y: 100 }, { x: 1100, y: 100 }]) {
        Object.assign(cursor, at)
        expect(placement.dropOutside(pet.id, 10)).toBe(false)
      }
      expect(store.get(pet.id)?.window).toBe(1)
      expect(arrivals).toEqual([])
    })

    it('a remote window on top of another window still keeps the drop: the one in front decides', () => {
      const { store, placement, cursor } = world([win(1, 0), win(2, 500), win(3, 500, { remote: true })], [30, 10, 20])
      const pet = store.assign(store.add(STARTER_PET).id, 1)
      Object.assign(cursor, { x: 600, y: 100 })
      expect(placement.dropOutside(pet.id, 10)).toBe(false)
    })

    it('refuses a pet that does not exist', () => {
      const { placement } = world([win(1, 0)])
      expect(() => placement.dropOutside('nope', 10)).toThrow()
    })
  })
})

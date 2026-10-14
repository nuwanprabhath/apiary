import type { PetArrival, PetRecord } from '@shared/pets/state'
import { pickWindowAt, type Point } from '../windows/windowAtPoint'
import type { PetStore } from './petStore'

interface Rect { x: number; y: number; width: number; height: number }

/** The slice of a window `PetPlacement` needs, so a unit test can pass plain objects. */
export interface PetWindow {
  /** `WindowManager`'s number: the one its layout is saved and restored with. */
  number: number
  webContentsId: number
  /** Shows another machine (`remote/`): it never hosts a pet and is never a drop target. */
  remote: boolean
  visible: boolean
  /** Outer bounds in screen coordinates, for the hit test. */
  bounds: Rect
  /** The page's area in screen coordinates, to give the target the drop point in its own. */
  content: Rect
  focus: () => void
}

export interface PetPlacementDeps {
  store: PetStore
  /** Read fresh every time: windows come and go. */
  windows: () => PetWindow[]
  /** webContents ids, most recently focused first (`TabMover`'s, `pickWindowAt`'s stand-in for z-order). */
  focusOrder: () => readonly number[]
  /** The pointer in screen coordinates (`screen.getCursorScreenPoint()`): never taken from the renderer. */
  cursor: () => Point
  /** A pet was dropped into a window from another: tell that window where it landed (and broadcast). */
  arrive: (arrival: Omit<PetArrival, 'seq'>) => void
  /** A pet's window changed: broadcast `petsChanged`. */
  changed: () => void
}

/**
 * Which window each pet is out in. A pet belongs to one window, by number, so after a restart it
 * is back where it was; only that window draws it. A pet with no window it can be in (new, from a
 * record older than windows, or its window gone) goes to the window that asked for it, else the
 * most recently focused local one, so a pet is never stranded. The cap of three is the store's,
 * across every window.
 */
export class PetPlacement {
  /** False until the startup restore has opened every window: before that, a pet whose window is
   *  merely not open yet would look stranded. */
  private started = false

  constructor(private readonly deps: PetPlacementDeps) {}

  private locals(): PetWindow[] {
    return this.deps.windows().filter((w) => !w.remote)
  }

  /** The most recently focused local window (one never focused counts last), or null for none. */
  private mostRecent(except: number | null = null): number | null {
    const order = this.deps.focusOrder()
    const rank = (w: PetWindow): number => {
      const i = order.indexOf(w.webContentsId)
      return i === -1 ? Number.POSITIVE_INFINITY : i
    }
    const candidates = this.locals().filter((w) => w.number !== except).sort((a, b) => rank(a) - rank(b))
    return candidates[0]?.number ?? null
  }

  /** The window a pet asked for by `senderId` goes to: that window, unless it cannot host one. */
  private homeFor(senderId: number): number | null {
    return this.locals().find((w) => w.webContentsId === senderId)?.number ?? this.mostRecent()
  }

  private homeless(): PetRecord[] {
    const live = new Set(this.locals().map((w) => w.number))
    return this.deps.store.list().filter((p) => p.active && (p.window === null || !live.has(p.window)))
  }

  private move(pets: PetRecord[], to: number | null): void {
    if (pets.length === 0 || to === null) return
    for (const pet of pets) this.deps.store.assign(pet.id, to)
    this.deps.changed()
  }

  /** The startup restore has opened every window it will: home whatever is still stranded. */
  start(): void {
    this.started = true
    this.rehome()
  }

  /** Every pet out with no live window of its number goes to the most recently focused window. */
  rehome(): void {
    if (this.started) this.move(this.homeless(), this.mostRecent())
  }

  /** After a pet was added or made active by `senderId`'s window: the new ones go to it. */
  adopt(senderId: number): void {
    this.move(this.homeless(), this.homeFor(senderId))
  }

  /** A pet put out again goes to the window that asked, wherever it was before. */
  activated(id: string, senderId: number): void {
    const pet = this.deps.store.get(id)
    if (pet?.active === true) this.move([pet], this.homeFor(senderId))
  }

  /**
   * A window closed. While the app carries on its pets go to the most recently focused other
   * window; on quit every window closes, and the pets keep its number for the restore.
   */
  windowClosed(number: number, opts: { quitting: boolean }): void {
    if (opts.quitting) return
    this.move(this.deps.store.list().filter((p) => p.active && p.window === number), this.mostRecent(number))
  }

  /**
   * A pet was released outside its window. Over another local window it moves there, landing at
   * the pointer; over none, its own, or one that cannot host it, it stays. True when it moved.
   */
  dropOutside(id: string, senderId: number): boolean {
    const pet = this.deps.store.get(id)
    if (pet === undefined) throw new Error('No such pet.')
    const windows = this.deps.windows()
    const at = this.deps.cursor()
    const hit = pickWindowAt(windows.map((w) => ({ id: w.webContentsId, ...w.bounds, visible: w.visible })), [...this.deps.focusOrder()], at)
    const target = windows.find((w) => w.webContentsId === hit)
    if (target === undefined || target.remote || target.webContentsId === senderId || target.number === pet.window) return false
    this.deps.store.assign(id, target.number)
    this.deps.arrive({ id, window: target.number, x: at.x - target.content.x, y: at.y - target.content.y })
    target.focus()
    return true
  }
}

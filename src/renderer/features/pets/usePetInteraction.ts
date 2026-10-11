import { type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type RefObject, type SetStateAction, useRef, useState } from 'react'
import { nearestPlace, placeToPoint, type Habitat } from '@shared/pets/habitat'
import { PET_SIZE_STEPS, type PetRecord } from '@shared/pets/state'
import type { ContextMenuItem } from '../../ui/contextMenuItem'
import { putPetAway, rememberPetPlace, resizePet } from '../../state/petsStore'
import type { BrainClient } from './brainClient'
import type { Pose } from './usePetBrain'

const DRAG_THRESHOLD_PX = 4

function without<T>(set: ReadonlySet<T>, item: T): Set<T> {
  const next = new Set(set)
  next.delete(item)
  return next
}

interface Deps {
  pets: PetRecord[]
  habitat: Habitat
  brain: RefObject<BrainClient | null>
  setPoses: Dispatch<SetStateAction<Record<string, Pose>>>
  onOpenSettings: (section: string) => void
}

/**
 * Moving, chatting with and asking things of a pet by hand: the drag (written straight onto the
 * element, no React render per pointer move), the keyboard's equivalents, and the pet menu.
 */
export function usePetInteraction({ pets, habitat, brain, setPoses, onOpenSettings }: Deps) {
  const [held, setHeld] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [chat, setChat] = useState<string | null>(null)
  const [asleep, setAsleep] = useState<ReadonlySet<string>>(() => new Set())
  const drag = useRef<{ id: string; x: number; y: number; moved: boolean; el: HTMLElement } | null>(null)

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>, id: string): void => {
    if (e.button !== 0) return
    // eslint-disable-next-line apiary/drag-via-use-resize-drag -- moving a pet in 2D with click-vs-drag detection, not resizing a separator: useResizeDrag's one-axis size model does not apply
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { id, x: e.clientX, y: e.clientY, moved: false, el: e.currentTarget }
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>, pet: PetRecord): void => {
    const d = drag.current
    if (d?.id !== pet.id) return
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < DRAG_THRESHOLD_PX) return
      d.moved = true
      setHeld(pet.id)
      setChat(null)
      brain.current?.send({ kind: 'held', id: pet.id })
    }
    // Straight onto the element while held: no React render per pointer move.
    d.el.style.transitionDuration = '0ms'
    d.el.style.transform = `translate(${String(e.clientX - pet.size / 2)}px, ${String(e.clientY - pet.size / 2)}px)`
  }

  const openChat = (id: string): void => {
    setChat(id)
    brain.current?.send({ kind: 'poke', id })
  }

  /** The keyboard's way to what a click and a right-click do: Enter or Space chats, the context-menu
   *  key or Shift+F10 opens the menu where the pet stands. */
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, pet: PetRecord): void => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openChat(pet.id)
    } else if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      e.preventDefault()
      const r = e.currentTarget.getBoundingClientRect()
      setChat(null)
      setMenu({ id: pet.id, x: r.left + r.width / 2, y: r.bottom })
    }
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>, pet: PetRecord): void => {
    const d = drag.current
    drag.current = null
    if (d?.id !== pet.id) return
    if (!d.moved) { openChat(pet.id); return }
    const place = nearestPlace(habitat, { x: e.clientX, y: e.clientY + pet.size / 2 }, pet.size)
    const pt = placeToPoint(habitat, place, pet.size)
    d.el.style.transform = `translate(${String(pt.x - pet.size / 2)}px, ${String(pt.y - pet.size)}px)`
    setHeld(null)
    setPoses((p) => ({ ...p, [pet.id]: { ...(p[pet.id]), place, ms: 0 } }))
    brain.current?.send({ kind: 'dropped', id: pet.id, place })
    rememberPetPlace(pet.id, place)
  }

  const onPointerCancel = (): void => { drag.current = null; setHeld(null) }

  const onContextMenu = (e: { preventDefault: () => void; clientX: number; clientY: number }, pet: PetRecord): void => {
    e.preventDefault()
    setChat(null)
    setMenu({ id: pet.id, x: e.clientX, y: e.clientY })
  }

  const menuPet = menu !== null ? pets.find((p) => p.id === menu.id) : undefined
  const menuItems: ContextMenuItem[] = menuPet === undefined ? [] : [
    { id: 'chat', label: `Chat with ${menuPet.spec.name}…`, run: () => { setChat(menuPet.id) } },
    ...PET_SIZE_STEPS.map((step, i) => ({
      id: `size-${String(step.size)}`, label: step.label, separator: i === 0, checked: menuPet.size === step.size,
      run: () => { resizePet(menuPet.id, step.size) },
    })),
    asleep.has(menuPet.id)
      ? { id: 'wake', label: 'Wake up', separator: true, run: () => { setAsleep((s) => without(s, menuPet.id)); brain.current?.send({ kind: 'sleep', id: menuPet.id, on: false }) } }
      : { id: 'sleep', label: 'Go to sleep', separator: true, run: () => { setAsleep((s) => new Set(s).add(menuPet.id)); brain.current?.send({ kind: 'sleep', id: menuPet.id, on: true }) } },
    { id: 'hide', label: `Put ${menuPet.spec.name} away`, run: () => { putPetAway(menuPet.id) } },
    { id: 'settings', label: 'Pet settings…', separator: true, run: () => { onOpenSettings('pets') } },
  ]

  return {
    held, menu, setMenu, chat, setChat, menuItems,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onKeyDown, onContextMenu },
  }
}

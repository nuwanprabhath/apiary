import { type JSX, useEffect, useMemo, useRef, useState } from 'react'
import type { ActiveTabPayload } from '@shared/domain/tabs'
import { nearestPlace, normalisePlace, placeToPoint, type Habitat } from '@shared/pets/habitat'
import type { ChatTurn } from '@shared/pets/prompt'
import type { PetArrival, PetRecord, PetsState } from '@shared/pets/state'
import { rememberPetPlace } from '../../state/petsStore'
import { windowNumber } from '../../state/windowParams'
import { ContextMenu } from '../../ui/ContextMenu'
import { SceneryLayer } from './SceneryLayer'
import { PetChat } from './PetChat'
import { PetFigure } from './PetFigure'
import { useHabitat } from './useHabitat'
import { usePetBrain, type Pose } from './usePetBrain'
import { usePetInteraction } from './usePetInteraction'

interface Props {
  /** The pets as main has them (`usePets`); null until known. */
  state: PetsState | null
  sidebarHidden: boolean
  /** Every window's tabs and what each is doing — what the pets react to. */
  tabs: ActiveTabPayload[]
  /** A tab's session title, for the pets' hourly lines; null when it has none. */
  titleOf: (key: string) => string | null
  onOpenSettings: (section: string) => void
}

/** Whether any pet is out — the status bar stays drawn for them to stand on. */
export function petsOut(state: PetsState | null): boolean {
  return state?.enabled === true && state.pets.some((p) => p.active)
}

/**
 * The pets, when they are on and at least one is out. Mounts nothing otherwise — no layer, no
 * worker, no timers.
 */
export function PetLayer(props: Props): JSX.Element | null {
  const { state } = props
  // A pet is out in one window: this one draws only its own (main decides which, `PetPlacement`).
  const pets = useMemo(() => (state?.enabled === true ? state.pets.filter((p) => p.active && p.window === windowNumber()) : []), [state])
  const habitat = useHabitat(pets.length > 0, props.sidebarHidden)
  if (pets.length === 0 || habitat === null) return null
  return <PetWorld {...props} pets={pets} habitat={habitat} />
}

/**
 * A pet dropped in from another window starts at the spot nearest the drop point (main sends it in
 * this window's coordinates), and that spot is saved once, which also tells main it has landed.
 */
function useArrival(pets: PetRecord[], arrival: PetArrival | null, habitat: Habitat): PetRecord[] {
  const landed = useRef(0)
  const here = arrival !== null && arrival.window === windowNumber() ? arrival : null
  const placed = useMemo(() => (here === null ? pets : pets.map((p) => (p.id === here.id
    ? { ...p, place: nearestPlace(habitat, { x: here.x, y: here.y + p.size / 2 }, p.size) }
    : p))), [pets, here, habitat])
  useEffect(() => {
    const pet = here === null || landed.current === here.seq ? undefined : placed.find((p) => p.id === here.id)
    if (here === null || pet === undefined || pet.place === null) return
    landed.current = here.seq
    rememberPetPlace(pet.id, pet.place)
  }, [placed, here])
  return placed
}

function PetWorld({ state, pets: own, habitat, tabs, titleOf, onOpenSettings }: Props & { pets: PetRecord[]; habitat: Habitat }): JSX.Element {
  const [histories, setHistories] = useState<Record<string, ChatTurn[]>>({})
  const pets = useArrival(own, state?.arrival ?? null, habitat)
  const { poses, setPoses, scenery, brain } = usePetBrain(pets, habitat, tabs, titleOf)
  const { held, menu, setMenu, chat, setChat, menuItems, handlers } = usePetInteraction({ pets, habitat, brain, poses, setPoses, onOpenSettings })

  const chatPet = chat !== null ? pets.find((p) => p.id === chat) : undefined
  const chatPose = chatPet !== undefined ? poses[chatPet.id] as Pose | undefined : undefined

  return (
    <div className="pet-layer" data-testid="pet-layer">
      <SceneryLayer habitat={habitat} items={scenery} size={pets.reduce((a, p) => a + p.size, 0) / pets.length} />
      {pets.map((pet) => {
        const pose = poses[pet.id] as Pose | undefined
        if (pose === undefined) return null
        return <PetFigure key={pet.id} pet={pet} pose={pose} habitat={habitat} held={held === pet.id} handlers={handlers} />
      })}
      <ContextMenu items={menuItems} position={menu !== null ? { x: menu.x, y: menu.y } : null} onClose={() => { setMenu(null) }} testId="pet-menu" />
      {chatPet !== undefined && chatPose !== undefined && (
        <PetChat
          pet={chatPet}
          anchor={placeToPoint(habitat, normalisePlace(habitat, chatPose.place, 0), chatPet.size)}
          history={histories[chatPet.id] ?? []}
          onSaid={(turns) => { setHistories((h) => ({ ...h, [chatPet.id]: [...(h[chatPet.id] ?? []), ...turns].slice(-20) })) }}
          onClose={() => { setChat(null) }}
        />
      )}
    </div>
  )
}

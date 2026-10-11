import { type JSX, useMemo, useState } from 'react'
import type { ActiveTabPayload } from '@shared/domain/tabs'
import { normalisePlace, placeToPoint, type Habitat } from '@shared/pets/habitat'
import type { ChatTurn } from '@shared/pets/prompt'
import type { PetRecord, PetsState } from '@shared/pets/state'
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
  const pets = useMemo(() => (state?.enabled === true ? state.pets.filter((p) => p.active) : []), [state])
  const habitat = useHabitat(pets.length > 0, props.sidebarHidden)
  if (pets.length === 0 || habitat === null) return null
  return <PetWorld {...props} pets={pets} habitat={habitat} />
}

function PetWorld({ pets, habitat, tabs, titleOf, onOpenSettings }: Props & { pets: PetRecord[]; habitat: Habitat }): JSX.Element {
  const [histories, setHistories] = useState<Record<string, ChatTurn[]>>({})
  const { poses, setPoses, scenery, brain } = usePetBrain(pets, habitat, tabs, titleOf)
  const { held, menu, setMenu, chat, setChat, menuItems, handlers } = usePetInteraction({ pets, habitat, brain, setPoses, onOpenSettings })

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
